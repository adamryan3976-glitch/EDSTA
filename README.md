# EDSTA App Collector

Staff pick their class(es), tick the apps they use from the "For Letter" tab, and give a purpose for each. Everything is stored in your Google Sheet, and a finished three-column table per class appears on its `Letters` tab, ready to paste into the DDSB parent letter.

## How the pieces fit
- **Page** (`docs/`): a static site on GitHub Pages. Staff sign in with Google through Firebase Authentication.
- **Backend** (`src/`): a Google Apps Script web app attached to your sheet. The page sends it the signed-in user's Firebase token. Apps Script asks Google to check the token, then allows only verified emails from your school domain. Nothing is trusted from the page.
- **Data**: your "EDSTA Software" sheet (`For Letter`, `Classes`, `Responses`, `Letters`). Firebase stores no data, it is used for sign-in only.

Note the Apps Script web app has to be deployed as "Anyone" so the GitHub Pages site can call it. The link looks public, but every request is rejected unless it carries a valid token for an allowed email.

## Setup (one time)

### 1. Sheet and Apps Script
1. Open the "EDSTA Software" sheet, Extensions > Apps Script.
2. Create `Logic` and `Code` (script) and paste in `src/Logic.js` and `src/Code.js`. In Project Settings tick "Show appsscript.json" and paste in `src/appsscript.json`. (Or use clasp: copy `.clasp.json.example` to `.clasp.json`, then `npm install` and `npm run push`.)
3. Add a `Classes` tab: column A = class name, column B = grade(s), header in row 1. Reload the sheet and run EDSTA > Set up tabs.

### 2. Firebase sign-in
1. In the Firebase console create a project (no Analytics needed). Build > Authentication > Get started > turn on the Google provider.
2. Authentication > Settings > Authorized domains: add `YOUR-GITHUB-USERNAME.github.io`.
3. Project settings > General: add a Web app and copy its config values (`apiKey`, `authDomain`, `projectId`) into `docs/config.js`.

### 3. Tell Apps Script who may use it
`src/Code.js` already contains the Firebase key and `ddsb.ca` as defaults at the top of the file. Edit them there for a different project or domain, or override with Script Properties (Project Settings > Script Properties):
- `FIREBASE_API_KEY` = the same web `apiKey`
- `ALLOWED_DOMAIN` = your staff email domain, for example `ddsb.ca`

### 3b. Optional staff list
Run EDSTA > Set up tabs to create a `Staff` tab. List one allowed email per row under the header (column A). If the tab has any emails, only those people can sign in, even if they have a `@ddsb.ca` account. If it is empty, anyone with a verified email in `ALLOWED_DOMAIN` can. Use it if student accounts share your domain. Changes take up to 5 minutes to apply.

### 4. Deploy the web app
Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the `/exec` URL into `scriptUrl` in `docs/config.js`. After any later code change: Deploy > Manage deployments > edit > New version.

### 5. Turn on GitHub Pages
Repo Settings > Pages > Deploy from branch > `main` and folder `/docs`. Commit your filled-in `docs/config.js`. Share the Pages link with staff.

## Behaviour
- One class: saved apps load pre-ticked and can be edited or removed.
- Several classes (specialists, rotary): saving only adds or updates apps; nothing is removed. Remove apps from one class at a time.
- Apps later removed from `For Letter` stay on the class table with a warning mark.
- A class renamed or removed from `Classes` shows under "Unknown class" on `Letters`.
- The personal-information text is looked up from `For Letter` each time, never copied.
- No student data is collected.

## Tests
`npm test` runs the unit tests for the pure logic (including the email-domain check). The page and sheet code can only be tested against the real services; use the dry run below.

## Dry run before sharing the link
- Sign in with a school account and with a personal Gmail; the Gmail account must be refused.
- One teacher saves one class, reloads, sees ticks restored.
- One specialist saves three classes at once; each gets the apps.
- Two people save at once; both rows appear.
- Open the Apps Script `/exec` URL in a browser: it should only say the service is running, with no data.

## Optional: deploy code from GitHub Actions
`.github/workflows/deploy.yml` can push `src/` to Apps Script when run by hand. It needs repository secrets `SCRIPT_ID` and `CLASPRC_JSON` (login file from `npx clasp login`), which can edit your Google scripts, so only add it if comfortable and keep the repo private. Skippable.
