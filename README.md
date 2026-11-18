# EDSTA App Collector

A Google Apps Script web app for one school. Staff pick their class(es), tick the apps they use from the "For Letter" tab, and give a purpose for each. A finished three-column table per class appears on the `Letters` tab, ready to paste into the DDSB parent letter.

## Important: where this runs

GitHub holds the code, but the app itself runs on Google. It reads and writes your Google Sheet, so it cannot run on GitHub Pages. Staff open a Google web-app link, and sign-in is limited to your board's Google domain.

## Layout
- `src/Logic.js` pure logic (tested)
- `src/Code.js` sheet access and web app entry
- `src/Index.html` staff page
- `src/appsscript.json` manifest (runs as the deployer, access limited to the domain)
- `test/logic.test.js` unit tests: `npm test`

## Option A: copy and paste (no tools)
1. Open the "EDSTA Software" sheet, then Extensions > Apps Script.
2. Create files `Logic` and `Code` (script) and `Index` (HTML) and paste in the matching files from `src/`. In Project Settings tick "Show appsscript.json" and paste in `src/appsscript.json`.
3. Add a `Classes` tab: column A = class name, column B = grade(s), header in row 1. Reload the sheet and run EDSTA > Set up tabs.
4. Deploy > New deployment > Web app. Execute as: Me. Who has access: anyone within your organization. Share the link.
5. After any change, Deploy > Manage deployments > edit > New version.

## Option B: push from this repo with clasp
1. `npm install`, then `npx clasp login`.
2. Copy `.clasp.json.example` to `.clasp.json` and put in your Apps Script project ID (Project Settings).
3. `npm run push`, then deploy as in step 4 above (the first deployment is done in the Apps Script editor).

## Optional: deploy from GitHub Actions
`.github/workflows/deploy.yml` can push `src/` to Apps Script when you run it by hand from the Actions tab. It needs two repository secrets, `SCRIPT_ID` and `CLASPRC_JSON` (the login file from `npx clasp login`). That file gives access to your Google scripts, so add it only if you are comfortable storing it as a secret, and keep the repo private. Skip this if unsure; Options A and B work without it.

## Behaviour
- One class: saved apps load pre-ticked and can be edited or removed.
- Several classes (specialists, rotary): saving only adds or updates apps; nothing is removed. Remove apps from one class at a time.
- Apps later removed from `For Letter` stay on the class table with a warning mark.
- Responses for a class that is renamed or removed from `Classes` show under "Unknown class" on `Letters`.
- The personal-information text is looked up from `For Letter` each time, never copied.
- No student data is collected.

## Dry run before sharing the link
- One teacher saves one class, reloads, sees ticks restored.
- One specialist saves three classes at once; each gets the apps.
- Two people save at the same time; both rows appear.
- If colleagues can't open the link, your board may block domain sharing; check with IT.
