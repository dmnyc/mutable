"use client";

import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/hooks/useAuth";
import {
  publishProfile,
  fetchRawProfileContent,
} from "@/lib/nostr";
import { uploadImageToBlossom } from "@/lib/imageUpload";
import { profileBackupService } from "@/lib/profileBackupService";
import { ProfileBackupData } from "@/lib/relayStorage";
import { Profile } from "@/types";
import {
  X,
  Camera,
  Loader2,
  Upload,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Save,
  AlertCircle,
  CheckCircle,
} from "lucide-react";

interface ProfileEditorModalProps {
  onClose: () => void;
  onProfileUpdated?: (profile: Profile) => void;
}

interface FormData {
  display_name: string;
  name: string;
  about: string;
  picture: string;
  banner: string;
  nip05: string;
  website: string;
  lud16: string;
}

export default function ProfileEditorModal({
  onClose,
  onProfileUpdated,
}: ProfileEditorModalProps) {
  const { session } = useAuth();
  const { userProfile, setUserProfile, signer } = useStore();

  // Form state
  const [formData, setFormData] = useState<FormData>({
    display_name: "",
    name: "",
    about: "",
    picture: "",
    banner: "",
    nip05: "",
    website: "",
    lud16: "",
  });

  // Raw existing kind:0 content (preserves unknown fields)
  const [existingContent, setExistingContent] = useState<Record<
    string,
    unknown
  > | null>(null);

  // Upload state
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Backup state
  const [showBackups, setShowBackups] = useState(false);
  const [backups, setBackups] = useState<
    Array<{ slot: number; data: ProfileBackupData }>
  >([]);
  const [loadingBackups, setLoadingBackups] = useState(false);

  // Messages
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // File input refs
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Initialize form from current profile
  useEffect(() => {
    if (userProfile) {
      setFormData({
        display_name: userProfile.display_name || "",
        name: userProfile.name || "",
        about: userProfile.about || "",
        picture: userProfile.picture || "",
        banner: userProfile.banner || "",
        nip05: userProfile.nip05 || "",
        website: userProfile.website || "",
        lud16: userProfile.lud16 || "",
      });
    }

    // Fetch raw content to preserve unknown fields
    if (session?.pubkey) {
      fetchRawProfileContent(session.pubkey, session.relays).then(
        (content) => {
          if (content) setExistingContent(content);
        },
      );
    }
  }, [userProfile, session]);

  // Handle image upload
  const handleImageUpload = async (
    file: File,
    type: "picture" | "banner",
  ) => {
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please select an image file");
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("Image must be under 10MB");
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }

    const setUploading =
      type === "picture" ? setUploadingPicture : setUploadingBanner;
    setUploading(true);
    setUploadProgress(0);

    try {
      const result = await uploadImageToBlossom({
        blob: file,
        filename: file.name,
        signer: signer || undefined,
        onProgress: (progress) => setUploadProgress(progress.percent),
      });

      setFormData((prev) => ({ ...prev, [type]: result.url }));
      setUploading(false);
    } catch (error) {
      setUploading(false);
      setErrorMessage(
        `Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  // Save profile
  const handleSave = async () => {
    if (!session) return;

    setSaving(true);
    setErrorMessage(null);

    try {
      // Step 1: Backup current profile before editing
      if (existingContent) {
        setSaveStatus("Backing up current profile...");
        const backupResult = await profileBackupService.saveBackup(
          existingContent,
          session.pubkey,
          session.relays,
        );
        if (!backupResult.success) {
          console.warn(
            "[ProfileEditor] Backup failed, continuing with save:",
            backupResult.error,
          );
        }
      }

      // Step 2: Publish updated profile
      setSaveStatus("Publishing profile...");
      await publishProfile(formData, existingContent || undefined, session.relays);

      // Step 3: Update store
      const updatedProfile: Profile = {
        pubkey: session.pubkey,
        ...formData,
      };
      setUserProfile(updatedProfile);

      if (onProfileUpdated) {
        onProfileUpdated(updatedProfile);
      }

      setSuccessMessage("Profile updated successfully!");
      setSaveStatus(null);

      // Close after brief delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      setSaveStatus(null);
      setErrorMessage(
        `Failed to save: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  // Load backups
  const handleToggleBackups = async () => {
    if (!showBackups && session) {
      setShowBackups(true);
      setLoadingBackups(true);
      try {
        const all = await profileBackupService.fetchAllBackups(
          session.pubkey,
          session.relays,
        );
        const valid = all.filter(
          (r): r is { slot: number; data: ProfileBackupData } =>
            r.data !== null && typeof r.data.timestamp === "number",
        );
        valid.sort((a, b) => b.data.timestamp - a.data.timestamp);
        setBackups(valid);
      } catch (error) {
        console.error("Failed to load backups:", error);
      } finally {
        setLoadingBackups(false);
      }
    } else {
      setShowBackups(false);
    }
  };

  // Restore from backup (populates form, does NOT auto-save)
  const handleRestore = (backup: ProfileBackupData) => {
    const p = backup.profile;
    setFormData({
      display_name: (p.display_name as string) || "",
      name: (p.name as string) || "",
      about: (p.about as string) || "",
      picture: (p.picture as string) || "",
      banner: (p.banner as string) || "",
      nip05: (p.nip05 as string) || "",
      website: (p.website as string) || "",
      lud16: (p.lud16 as string) || "",
    });
    // Also update existingContent so unknown fields are preserved from backup
    setExistingContent(backup.profile);
    setSuccessMessage(
      "Backup restored to form. Review and click Save to publish.",
    );
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Banner Area */}
        <div className="relative">
          <div
            className="h-40 sm:h-48 bg-gradient-to-r from-red-500 to-red-700 rounded-t-lg cursor-pointer relative overflow-hidden group"
            onClick={() => bannerInputRef.current?.click()}
          >
            {formData.banner && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={formData.banner}
                alt="Banner"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center">
              {uploadingBanner ? (
                <div className="flex flex-col items-center text-white">
                  <Loader2 size={32} className="animate-spin" />
                  <span className="text-sm mt-1">{uploadProgress}%</span>
                </div>
              ) : (
                <Camera
                  size={32}
                  className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                />
              )}
            </div>
          </div>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageUpload(file, "banner");
              e.target.value = "";
            }}
          />

          {/* Close button */}
          <button
            onClick={onClose}
            disabled={saving}
            className="absolute top-3 right-3 p-1.5 bg-black bg-opacity-50 hover:bg-opacity-70 rounded-full text-white transition-colors"
          >
            <X size={20} />
          </button>

          {/* Avatar */}
          <div className="absolute -bottom-12 left-6">
            <div
              className="w-24 h-24 rounded-full border-4 border-white dark:border-gray-800 bg-gray-300 dark:bg-gray-600 cursor-pointer relative overflow-hidden group"
              onClick={() => pictureInputRef.current?.click()}
            >
              {formData.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={formData.picture}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500 dark:text-gray-400 text-2xl font-bold">
                  {formData.display_name?.[0] || formData.name?.[0] || "?"}
                </div>
              )}
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center">
                {uploadingPicture ? (
                  <Loader2
                    size={24}
                    className="text-white animate-spin"
                  />
                ) : (
                  <Camera
                    size={24}
                    className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                )}
              </div>
            </div>
            <input
              ref={pictureInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file, "picture");
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* Form Body */}
        <div className="pt-16 px-6 pb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
            Edit Profile
          </h2>

          {/* Messages */}
          {successMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 border border-green-400 dark:border-green-700 rounded-lg flex items-center gap-2">
              <CheckCircle
                size={18}
                className="text-green-600 dark:text-green-400 flex-shrink-0"
              />
              <span className="text-sm text-green-800 dark:text-green-200">
                {successMessage}
              </span>
            </div>
          )}

          {errorMessage && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg flex items-center gap-2">
              <AlertCircle
                size={18}
                className="text-red-600 dark:text-red-400 flex-shrink-0"
              />
              <span className="text-sm text-red-800 dark:text-red-200">
                {errorMessage}
              </span>
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={formData.display_name}
                onChange={(e) => updateField("display_name", e.target.value)}
                maxLength={50}
                placeholder="Your display name"
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Username
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateField("name", e.target.value)}
                maxLength={30}
                placeholder="username"
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                About
              </label>
              <textarea
                value={formData.about}
                onChange={(e) => updateField("about", e.target.value)}
                rows={4}
                placeholder="Tell the world about yourself"
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent resize-vertical"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Profile Picture URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={formData.picture}
                  onChange={(e) => updateField("picture", e.target.value)}
                  placeholder="https://..."
                  className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
                <button
                  onClick={() => pictureInputRef.current?.click()}
                  disabled={uploadingPicture}
                  className="flex items-center gap-1 px-3 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors text-sm disabled:opacity-50"
                >
                  {uploadingPicture ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Banner URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={formData.banner}
                  onChange={(e) => updateField("banner", e.target.value)}
                  placeholder="https://..."
                  className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
                <button
                  onClick={() => bannerInputRef.current?.click()}
                  disabled={uploadingBanner}
                  className="flex items-center gap-1 px-3 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors text-sm disabled:opacity-50"
                >
                  {uploadingBanner ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                NIP-05 Identifier
              </label>
              <input
                type="text"
                value={formData.nip05}
                onChange={(e) => updateField("nip05", e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Website
              </label>
              <input
                type="url"
                value={formData.website}
                onChange={(e) => updateField("website", e.target.value)}
                placeholder="https://yoursite.com"
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Lightning Address
              </label>
              <input
                type="text"
                value={formData.lud16}
                onChange={(e) => updateField("lud16", e.target.value)}
                placeholder="you@getalby.com"
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Profile Backups Section */}
          <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
            <button
              onClick={handleToggleBackups}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <RotateCcw size={16} />
              <span>Profile Backups</span>
              {showBackups ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </button>

            {showBackups && (
              <div className="mt-3 space-y-2">
                {loadingBackups ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <Loader2 size={14} className="animate-spin" />
                    <span>Loading backups...</span>
                  </div>
                ) : backups.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No profile backups found. Backups are created automatically
                    when you save profile changes.
                  </p>
                ) : (
                  backups.map((backup) => (
                    <div
                      key={backup.slot}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {(backup.data.profile.display_name as string) ||
                            (backup.data.profile.name as string) ||
                            "Unnamed"}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(backup.data.timestamp)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRestore(backup.data)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                      >
                        <RotateCcw size={14} />
                        Restore
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || uploadingPicture || uploadingBanner}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {saveStatus || "Saving..."}
                </>
              ) : (
                <>
                  <Save size={16} />
                  Save Profile
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
