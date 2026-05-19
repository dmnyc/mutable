#!/usr/bin/env python3
"""
nip05-btc-balance — query a Nostr identity and report any Bitcoin balance.

Reproduces the utility described in note15fqa0w8d230ksr0t5me8rvvrupsmx8s03fayuf9kztrv9yd7afls79ngjx:
a Nostr pubkey is an secp256k1 x-only key, i.e. also a Bitcoin key. Resolve a
NIP-05 address (or npub / nprofile / raw hex) to its pubkey, derive the Bitcoin
addresses that key controls, and check the chain for a balance.

The point is defensive awareness: your nsec is a Bitcoin private key too.

Usage:
    ./nip05-btc-balance.py <identity> [<identity> ...]
    ./nip05-btc-balance.py --history <identity>     full tx/balance ledger
    ./nip05-btc-balance.py --json [--history] <identity>
    ./nip05-btc-balance.py --selftest

Every address and transaction is reported with an explorer (mempool.space)
link. --history walks the full chain history per address with a running
balance.

<identity> is any of:
    name@domain.com        NIP-05 address
    domain.com             NIP-05 "_" root identity
    npub1...               NIP-19 npub
    nprofile1...           NIP-19 nprofile
    <64-hex>               raw x-only pubkey

Stdlib only. Read-only (HTTPS GET to the domain's nostr.json and mempool.space).
"""
import sys, json, hashlib, urllib.request, urllib.parse, time

EXPLORER = "https://mempool.space/api"
UA = {"User-Agent": "nip05-btc-balance/1.0 (+defensive-research)"}

# ---------- bech32 / bech32m (BIP173 + BIP350 reference) ----------
CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

def _polymod(values):
    GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = ((chk & 0x1ffffff) << 5) ^ v
        for i in range(5):
            chk ^= GEN[i] if ((b >> i) & 1) else 0
    return chk

def _hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]

def _checksum(hrp, data, spec):
    const = 0x2bc830a3 if spec == "bech32m" else 1
    pm = _polymod(_hrp_expand(hrp) + data + [0] * 6) ^ const
    return [(pm >> 5 * (5 - i)) & 31 for i in range(6)]

def bech32_encode(hrp, data, spec):
    combined = data + _checksum(hrp, data, spec)
    return hrp + "1" + "".join(CHARSET[d] for d in combined)

def bech32_decode(bech):
    bech = bech.strip().lower()
    pos = bech.rfind("1")
    if pos < 1 or pos + 7 > len(bech):
        raise ValueError("malformed bech32")
    hrp = bech[:pos]
    data = [CHARSET.find(c) for c in bech[pos + 1:]]
    if -1 in data:
        raise ValueError("bad bech32 char")
    for spec in ("bech32", "bech32m"):
        const = 0x2bc830a3 if spec == "bech32m" else 1
        if _polymod(_hrp_expand(hrp) + data) == const:
            return hrp, data[:-6]
    raise ValueError("bad bech32 checksum")

def convertbits(data, frm, to, pad=True):
    acc = bits = 0
    ret = []
    maxv = (1 << to) - 1
    for value in data:
        acc = (acc << frm) | value
        bits += frm
        while bits >= to:
            bits -= to
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (to - bits)) & maxv)
    elif not pad and (bits >= frm or ((acc << (to - bits)) & maxv)):
        raise ValueError("non-zero padding in bech32 data")
    return ret

def segwit_addr(hrp, witver, witprog):
    spec = "bech32" if witver == 0 else "bech32m"
    return bech32_encode(hrp, [witver] + convertbits(list(witprog), 8, 5), spec)

# ---------- base58check ----------
_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def b58encode(b):
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = _B58[r] + s
    pad = len(b) - len(b.lstrip(b"\x00"))
    return "1" * pad + s

def b58check(payload):
    chk = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    return b58encode(payload + chk)

def hash160(b):
    try:
        return hashlib.new("ripemd160", hashlib.sha256(b).digest()).digest()
    except (ValueError, TypeError):
        sys.exit("error: this Python build lacks RIPEMD-160 (OpenSSL legacy "
                 "provider disabled); cannot derive Bitcoin addresses.")

# ---------- nostr identity -> 32-byte x-only pubkey (hex) ----------
def resolve_nip05(addr):
    local, domain = addr.split("@", 1) if "@" in addr else ("_", addr)
    url = f"https://{domain}/.well-known/nostr.json?name={urllib.parse.quote(local)}"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=15) as r:
        doc = json.load(r)
    pk = (doc.get("names") or {}).get(local)
    if not pk:
        raise ValueError(f"NIP-05 '{addr}' has no entry for name '{local}'")
    return pk.lower()

def nprofile_pubkey(s):
    _, data = bech32_decode(s)
    tlv = bytes(convertbits(data, 5, 8, False))
    i = 0
    while i + 2 <= len(tlv):
        t, ln = tlv[i], tlv[i + 1]
        val = tlv[i + 2:i + 2 + ln]
        if t == 0 and ln == 32:                      # TLV type 0 = special (pubkey)
            return val.hex()
        i += 2 + ln
    raise ValueError("nprofile contains no pubkey TLV")

def to_pubkey(identity):
    s = identity.strip()
    if s.startswith("npub1"):
        _, data = bech32_decode(s)
        return ("npub", bytes(convertbits(data, 5, 8, False)).hex())
    if s.startswith("nprofile1"):
        return ("nprofile", nprofile_pubkey(s))
    low = s.lower()
    if len(low) == 64 and all(c in "0123456789abcdef" for c in low):
        return ("hex", low)
    if "." in s:                                     # looks like a NIP-05 domain/address
        return ("nip05", resolve_nip05(s))
    raise ValueError(f"unrecognized identity: {identity!r}")

# ---------- key -> bitcoin addresses ----------
SECP_P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F

def _lift_y(x, want_odd):
    """Recover Y for an x-only key. secp256k1 p ≡ 3 (mod 4) → sqrt = a^((p+1)/4)."""
    a = (pow(x, 3, SECP_P) + 7) % SECP_P
    y = pow(a, (SECP_P + 1) // 4, SECP_P)
    if (y * y - a) % SECP_P != 0:
        return None                       # x is not a valid curve point
    return SECP_P - y if (y & 1) != want_odd else y

# --- minimal secp256k1 for the BIP341 taproot tweak ---
SECP_G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
          0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)

def _inv(a):
    return pow(a, SECP_P - 2, SECP_P)

def _pt_add(P, Q):
    if P is None: return Q
    if Q is None: return P
    x1, y1 = P; x2, y2 = Q
    if x1 == x2 and (y1 + y2) % SECP_P == 0:
        return None                                   # point at infinity
    m = ((3 * x1 * x1) * _inv(2 * y1) if P == Q
         else (y2 - y1) * _inv(x2 - x1)) % SECP_P
    x3 = (m * m - x1 - x2) % SECP_P
    return (x3, (m * (x1 - x3) - y1) % SECP_P)

def _scalar_mult(k, P):
    R = None
    while k:
        if k & 1:
            R = _pt_add(R, P)
        P = _pt_add(P, P)
        k >>= 1
    return R

def _tagged_hash(tag, msg):
    th = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(th + th + msg).digest()

def _lift_x_even(x):
    """BIP340 lift_x: the unique point with this X and even Y."""
    a = (pow(x, 3, SECP_P) + 7) % SECP_P
    y = pow(a, (SECP_P + 1) // 4, SECP_P)
    if (y * y - a) % SECP_P != 0:
        return None
    return (x, SECP_P - y if (y & 1) else y)

def p2tr_keypath(xonly):
    """Canonical BIP341 key-path output key: Q = P + tagged('TapTweak',P)*G."""
    P = _lift_x_even(int.from_bytes(xonly, "big"))
    if P is None:
        return None
    t = int.from_bytes(_tagged_hash("TapTweak", xonly), "big")
    Q = _pt_add(P, _scalar_mult(t, SECP_G))
    return Q[0].to_bytes(32, "big")

def derive_addresses(xonly_hex):
    xonly = bytes.fromhex(xonly_hex)
    if len(xonly) != 32:
        raise ValueError("pubkey is not 32 bytes (x-only)")
    x = int.from_bytes(xonly, "big")
    out = []
    # Bitcoin's Y-parity for this x-only key is unknown, so each hash160-based
    # type has TWO candidates (0x02 / 0x03 compressed forms) — check both.
    for prefix, tag in ((b"\x02", "02"), (b"\x03", "03")):
        h160 = hash160(prefix + xonly)
        out.append((f"P2PKH-{tag}",  b58check(b"\x00" + h160)))
        out.append((f"P2WPKH-{tag}", segwit_addr("bc", 0, h160)))
        redeem = hash160(b"\x00\x14" + h160)          # BIP141 P2WPKH redeemscript
        out.append((f"P2SH-{tag}",   b58check(b"\x05" + redeem)))
    # uncompressed legacy P2PKH (recover full point; both Y parities)
    for want_odd, tag in ((0, "Uev"), (1, "Uod")):
        y = _lift_y(x, want_odd)
        if y is not None:
            unc = b"\x04" + xonly + y.to_bytes(32, "big")
            out.append((f"P2PKH-{tag}", b58check(b"\x00" + hash160(unc))))
    # Canonical Taproot (BIP341 key-path): the address encodes the *tweaked*
    # output key Q = P + TapTweak(P)*G, not the raw internal key. This is what
    # real wallets and the OPENETR reference app use.
    qx = p2tr_keypath(xonly)
    if qx is not None:
        out.append(("P2TR", segwit_addr("bc", 1, qx)))
    out.append(("P2TR-raw", segwit_addr("bc", 1, xonly)))   # untweaked (naive)
    return out

# ---------- balances + history (Esplora) ----------
EXPLORER_WEB = EXPLORER.rsplit("/api", 1)[0]          # https://mempool.space

def _get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)

def addr_url(addr):
    return f"{EXPLORER_WEB}/address/{addr}"

def tx_url(txid):
    return f"{EXPLORER_WEB}/tx/{txid}"

def address_balance(addr):
    """Return (confirmed_sats, unconfirmed_sats, tx_count) from Esplora."""
    d = _get_json(f"{EXPLORER}/address/{addr}")
    c, m = d["chain_stats"], d["mempool_stats"]
    confirmed = c["funded_txo_sum"] - c["spent_txo_sum"]
    unconfirmed = m["funded_txo_sum"] - m["spent_txo_sum"]
    return confirmed, unconfirmed, c["tx_count"] + m["tx_count"]

def address_txs(addr, max_txs=5000):
    """All txs for addr (confirmed oldest->newest, then mempool/pending)."""
    mp = _get_json(f"{EXPLORER}/address/{addr}/txs/mempool")
    conf, last = [], None
    while len(conf) < max_txs:
        url = f"{EXPLORER}/address/{addr}/txs/chain"
        if last:
            url += f"/{last}"
        batch = _get_json(url)
        if not batch:
            break
        conf.extend(batch)
        last = batch[-1]["txid"]
        if len(batch) < 25:
            break
        time.sleep(0.3)
    conf.reverse()                                    # oldest -> newest
    return conf + list(reversed(mp))                  # pending last

def tx_delta(tx, addr):
    """Net sats effect of `tx` on `addr` (received in vout minus spent in vin)."""
    got = sum(v.get("value", 0) for v in tx.get("vout", [])
              if v.get("scriptpubkey_address") == addr)
    spent = sum(i.get("prevout", {}).get("value", 0) for i in tx.get("vin", [])
                if i.get("prevout", {}).get("scriptpubkey_address") == addr)
    return got - spent

def build_ledger(addr):
    """Full per-address ledger with a running balance and explorer links."""
    led, run = [], 0
    for t in address_txs(addr):
        d = tx_delta(t, addr)
        run += d
        st = t.get("status", {})
        led.append({
            "txid": t["txid"], "tx_url": tx_url(t["txid"]),
            "confirmed": st.get("confirmed", False),
            "height": st.get("block_height"),
            "time": st.get("block_time"),
            "delta_sats": d, "running_sats": run,
        })
    return led

def sats_str(s):
    return f"{s:,} sats ({s/1e8:.8f} BTC)"

def _date(ts):
    return time.strftime("%Y-%m-%d", time.gmtime(ts)) if ts else "pending   "

# ---------- per-identity report ----------
def process(identity, history=False):
    kind, pk = to_pubkey(identity)
    npub = bech32_encode("npub", convertbits(bytes.fromhex(pk), 8, 5), "bech32")
    result = {"input": identity, "resolved_via": kind, "pubkey": pk,
              "npub": npub, "addresses": [], "total_sats": 0}
    for label, addr in derive_addresses(pk):
        entry = {"type": label, "address": addr, "address_url": addr_url(addr)}
        try:
            conf, unconf, txc = address_balance(addr)
            entry.update(confirmed_sats=conf, unconfirmed_sats=unconf, tx_count=txc)
            result["total_sats"] += conf + unconf
            if history and txc:                      # only walk addresses with activity
                try:
                    entry["history"] = build_ledger(addr)
                except Exception as e:
                    entry["history_error"] = str(e)
                time.sleep(0.4)
        except Exception as e:                       # network/rate-limit: degrade gracefully
            entry["error"] = str(e)
        result["addresses"].append(entry)
        time.sleep(0.6)                              # be polite to the public API
    return result

def print_human(res):
    flag = "  ⚠ FUNDED" if res["total_sats"] > 0 else ""
    print(f"\n{res['input']}  (via {res['resolved_via']}){flag}")
    print(f"  pubkey : {res['pubkey']}")
    print(f"  npub   : {res['npub']}")
    for a in res["addresses"]:
        if "error" in a:
            print(f"  {a['type']:<10} {a['address']:<46} balance: ?  ({a['error']})")
            continue
        bal = a["confirmed_sats"] + a["unconfirmed_sats"]
        mark = "  ⚠" if bal > 0 else ""
        unc = f" (+{a['unconfirmed_sats']} unconf)" if a["unconfirmed_sats"] else ""
        print(f"  {a['type']:<10} {a['address']:<46} "
              f"balance: {a['confirmed_sats']:,} sats{unc}  ({a['tx_count']} tx){mark}")
        if a.get("tx_count"):
            print(f"             ↳ {a['address_url']}")
        if "history_error" in a:
            print(f"             history unavailable: {a['history_error']}")
        for h in a.get("history", []):
            sign = "+" if h["delta_sats"] >= 0 else "−"
            tag = "" if h["confirmed"] else "  (pending)"
            print(f"             {_date(h['time'])}  {sign}{abs(h['delta_sats']):>12,}"
                  f"  bal {h['running_sats']:>13,}{tag}  {h['tx_url']}")
    print(f"  TOTAL  : {sats_str(res['total_sats'])}"
          f"{'  ⚠ KEY HOLDS FUNDS' if res['total_sats'] else ''}")

# ---------- self-test (offline; BIP173 generator-point vectors) ----------
def selftest():
    x = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    addrs = dict(derive_addresses(x))
    # BIP341 key-path vector from the OPENETR reference app (alex@gleasonator.com)
    ik = "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd"
    tk = _tagged_hash("TapTweak", bytes.fromhex(ik)).hex()
    tv = dict(derive_addresses(ik))
    checks = {
        "P2PKH-02":  ("1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH", addrs["P2PKH-02"]),
        "P2WPKH-02": ("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", addrs["P2WPKH-02"]),
        "TapTweak":  ("1619853a7b2e50b0e759137fbf7378e67883c9a43d63f6e32f6633e54b8cadd7", tk),
        "P2TR(341)": ("bc1pvdaezs0mdhxgrfhw2zjsw4r02wlzrafd7stxcvpzzscsh8hv6vhqdc9ets", tv["P2TR"]),
    }
    ok = True
    for name, (want, got) in checks.items():
        good = want == got
        ok &= good
        print(f"  {'PASS' if good else 'FAIL'} {name}: {got}"
              f"{'' if good else '  expected ' + want}")
    print(f"  info P2TR-raw(untweaked): {addrs['P2TR-raw']}")
    print("selftest:", "OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)

def main(argv):
    as_json = history = False
    while argv and argv[0].startswith("-"):
        flag, argv = argv[0], argv[1:]
        if flag in ("-h", "--help"):
            print(__doc__); return 0
        elif flag == "--selftest":
            selftest()
        elif flag == "--json":
            as_json = True
        elif flag == "--history":
            history = True
        else:
            print(f"error: unknown flag {flag}", file=sys.stderr); return 2
    if not argv:
        print("error: no identity given", file=sys.stderr)
        return 2
    out, rc = [], 0
    for ident in argv:
        try:
            res = process(ident, history=history)
            out.append(res)
            if not as_json:
                print_human(res)
        except Exception as e:
            rc = 1
            if as_json:
                out.append({"input": ident, "error": str(e)})
            else:
                print(f"\n{ident}\n  error: {e}", file=sys.stderr)
    if as_json:
        print(json.dumps(out, indent=2))
    return rc

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
