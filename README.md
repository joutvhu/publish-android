# Publish Android

This GitHub Action to upload an Android release (.apk or .aab) to the Google Play Store.

## Usage

See [action.yml](action.yml)

## Example

```yaml
uses: joutvhu/publish-android@v1
with:
  serviceAccountJson: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
  packageName: com.example.MyApp
  releaseFile: |
    app/build/outputs/bundle/release/app-release-1.aab
    app/build/outputs/bundle/release/app-release-2.aab
  track: production
  status: inProgress
  inAppUpdatePriority: 2
  userFraction: 0.25
  whatsNewDirectory: distribution/whatsnew
  mappingFile: app/build/outputs/mapping/release/mapping.txt
```
