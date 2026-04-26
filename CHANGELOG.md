# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-04-26

### Breaking Changes
- Removed `authClient` from `PublishInputs` — auth is now handled internally via `GoogleAuth` instance passed directly to the API client, eliminating the need to pass auth per-call
- `@actions/core` downgraded from v3 to v2.0.3 for CJS compatibility with ncc bundler (v3 is ESM-only)

### Added
- New input `deviceTierConfigId`: Device tier config (DTC) for generating deliverables when uploading `.aab` files. Accepts a DTC ID or `"LATEST"`
- `ignoreDeprecations: "6.0"` in `tsconfig.json` to silence TypeScript 6 deprecation warnings for `baseUrl`, `downlevelIteration`, and `moduleResolution: node`

### Changed
- Upgraded `@googleapis/androidpublisher` to `^35.3.0`
- Upgraded `@actions/core` to `2.0.3`
- Upgraded `typescript` to `^6.0.3`
- Upgraded `@types/node` to `^24.12.2`
- Upgraded `@typescript-eslint/*` to `^8.59.0`
- Upgraded `eslint` to `^9.39.4`
- Upgraded `rimraf` to `^6.1.3`
- Upgraded `jest` to `^30.3.0`
- Upgraded `prettier` to `^3.8.3`
- Updated `runs.using` in `action.yml` from `node20` to `node24`
- Updated `tsconfig.json` compile target from `es2015` to `es2022`
- `status` input: empty value is now treated as `undefined` (no longer throws an error when status is not provided)
- `getBooleanInput`, `getIntegerInput`, `getFloatInput`: fixed return logic — `defaultValue` is now always returned when input is blank, regardless of `required` option
- `releaseName` and `inAppUpdatePriority` in `PublishInputs` are now correctly typed as optional (`string?`, `number?`)
- Removed `default: '0'` from `inAppUpdatePriority` in `action.yml` so the field is truly optional
- Removed redundant `if (mapping != undefined)` check in `uploadMappingFile`
- Removed redundant `if (data != null)` check in `uploadDebugSymbolsFile`
- Fixed `readLocalizedReleaseNotes` regex match check from `matches.length == 4` to `matches[1] != undefined`
- Fixed swapped output descriptions for `internalSharingDownloadUrl` and `internalSharingDownloadUrls` in `action.yml`
- Fixed `action.yml` description from "Get a release by tag..." to correct description
- Fixed `::set-output` deprecated syntax in `.github/workflows/update-tag.yml` — migrated to `$GITHUB_OUTPUT`
- Removed unused `isBlank` export from `io-helper.ts`
- Replaced `console.log` with `core.warning` for missing service account message
- `zipFileAddDirectory`: replaced index-based `for` loop with `for...of`
- `uploadToPlayStore`: non-internalsharing track now returns `[]` instead of incorrect internal app sharing URLs

### Fixed
- Build error: `@actions/core` v3 ESM-only package caused ncc bundling failure
- Build error: `auth` type mismatch — `Compute | JSONClient` incompatible with updated `google-auth-library` types
- TypeScript errors across all API calls due to incorrect `auth` parameter type

---

## [1.0.1] - 2023-02-05

### Added
- New input `debugSymbols`: upload native debug symbols (`.zip` file or directory) to Google Play
- New input `existingEditId`: reuse an existing in-progress edit instead of creating a new one
- `getBooleanInput`, `getIntegerInput`, `getFloatInput` helper functions in `io-helper.ts`
- `inAppUpdatePriority` validation (must be between 0 and 5)
- `userFraction` validation (must be between 0.0 and 1.0)
- `status` validation with cross-check against `userFraction`

### Changed
- Upgraded dependencies
- Refactored `getInputs()` with improved validation and error messages

---

## [1.0.0] - 2022-07-25

### Added
- Initial release
- Upload `.apk` or `.aab` to Google Play Store via the Android Publisher API
- Support for multiple release files (newline-separated, glob patterns)
- Inputs: `serviceAccountJson`, `packageName`, `releaseFile`, `releaseName`, `track`, `inAppUpdatePriority`, `userFraction`, `status`, `whatsNewDirectory`, `mappingFile`, `changesNotSentForReview`
- Support for `internalsharing` track with dedicated upload API
- Localized release notes via `whatsNewDirectory` (BCP 47 locale format)
- ProGuard mapping file upload (`mappingFile`)
- Outputs: `internalSharingDownloadUrl`, `internalSharingDownloadUrls`
- Automatic cleanup of temporary service account credentials file
- GitHub workflow to auto-update major version tag on release
