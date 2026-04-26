# Publish Android

A GitHub Action to upload an Android release (`.apk` or `.aab`) to the Google Play Store.

## Usage

See [action.yml](action.yml)

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `serviceAccountJson` | ✅ | | The service account JSON private key file path, or the raw JSON text, used to authorize the upload |
| `packageName` | ✅ | | The package name (Application ID) of the app |
| `releaseFile` | ✅ | | The release file(s) to upload (`.apk` or `.aab`). Multiple files can be supplied on new lines. Supports glob patterns |
| `releaseName` | | | The name of this release. If not set, it's generated automatically from the APK's `versionName` |
| `track` | ✅ | `production` | The track to assign the uploaded app to. Use `internalsharing` for Internal App Sharing |
| `status` | | `completed` | Release status. Options: `completed`, `inProgress`, `halted`, `draft` |
| `inAppUpdatePriority` | | | In-app update priority of the release. Range: `[0, 5]`, with `5` being the highest |
| `userFraction` | | | Fraction of users for a staged rollout. Range: `(0.0, 1.0)`. Required when `status` is `inProgress` or `halted` |
| `whatsNewDirectory` | | | Directory containing localized release notes. Files must follow the pattern `whatsnew-<LOCALE>` (BCP 47 format) |
| `mappingFile` | | | Path to `mapping.txt` for de-obfuscating crash stack traces (ProGuard) |
| `debugSymbols` | | | Path to a native debug symbols `.zip` file or directory |
| `changesNotSentForReview` | | `false` | If `true`, changes will not be sent for review automatically. Review must be triggered manually from the Google Play Console |
| `existingEditId` | | | ID of an existing in-progress edit to append to, instead of creating a new one |
| `deviceTierConfigId` | | | Device Tier Config (DTC) ID for generating deliverables when uploading an `.aab`. Use `"LATEST"` for the most recently uploaded DTC |

## Outputs

| Output | Env Variable | Description |
|--------|-------------|-------------|
| `internalSharingDownloadUrl` | `INTERNAL_SHARING_DOWNLOAD_URL` | Download URL of the last file uploaded via the `internalsharing` track |
| `internalSharingDownloadUrls` | `INTERNAL_SHARING_DOWNLOAD_URLS` | JSON list of download URLs for all files uploaded via the `internalsharing` track |

## Examples

### Production release

```yaml
- uses: joutvhu/publish-android@v2
  with:
    serviceAccountJson: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
    packageName: com.example.MyApp
    releaseFile: app/build/outputs/bundle/release/app-release.aab
    track: production
    status: completed
```

### Staged rollout (50% of users)

```yaml
- uses: joutvhu/publish-android@v2
  with:
    serviceAccountJson: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
    packageName: com.example.MyApp
    releaseFile: app/build/outputs/bundle/release/app-release.aab
    track: production
    status: inProgress
    userFraction: 0.5
    inAppUpdatePriority: 2
```

### Multiple files with release notes

```yaml
- uses: joutvhu/publish-android@v2
  with:
    serviceAccountJson: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
    packageName: com.example.MyApp
    releaseFile: |
      app/build/outputs/bundle/release/app-release-1.aab
      app/build/outputs/bundle/release/app-release-2.aab
    track: production
    status: completed
    whatsNewDirectory: distribution/whatsnew
    mappingFile: app/build/outputs/mapping/release/mapping.txt
```

### Internal App Sharing

```yaml
- uses: joutvhu/publish-android@v2
  with:
    serviceAccountJson: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
    packageName: com.example.MyApp
    releaseFile: app/build/outputs/bundle/release/app-release.aab
    track: internalsharing
```

### With debug symbols and Device Tier Config

```yaml
- uses: joutvhu/publish-android@v2
  with:
    serviceAccountJson: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
    packageName: com.example.MyApp
    releaseFile: app/build/outputs/bundle/release/app-release.aab
    track: production
    status: completed
    debugSymbols: app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip
    deviceTierConfigId: LATEST
```

## Service Account Setup

1. Create a service account in [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Grant the service account access to your app in [Google Play Console](https://play.google.com/console) under **Setup → API access**
3. Download the JSON key and store it as a GitHub secret (e.g. `GOOGLE_SERVICE_ACCOUNT_JSON`)

You can pass either the **file path** to the JSON key or the **raw JSON content** as the `serviceAccountJson` input.

## Localized Release Notes

Place release note files in a directory and pass it as `whatsNewDirectory`. Each file must be named `whatsnew-<LOCALE>` using [BCP 47](https://tools.ietf.org/html/bcp47) locale codes.

```
distribution/
  whatsnew/
    whatsnew-en-US
    whatsnew-vi
    whatsnew-ja-JP
```

## License

[MIT](LICENSE)
