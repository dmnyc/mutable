/**
 * The ambient canvas behind every page: gradient base, faint grid, two
 * slow-drifting color fogs, film grain, and a vignette. Pure CSS — mounted
 * once in the root layout, fixed and pointer-events-none, so it costs no
 * interaction latency. Colors and intensities come from the token
 * variables in globals.css and flip with the theme class.
 */
export default function AmbientBackdrop() {
  return (
    <div aria-hidden="true" className="backdrop-root">
      <div className="backdrop-gradient" />
      <div className="backdrop-grid" />
      <div className="backdrop-fog backdrop-fog-a" />
      <div className="backdrop-fog backdrop-fog-b" />
      <div className="backdrop-grain" />
      <div className="backdrop-vignette" />
    </div>
  );
}
