# Role Model Vote

Live school vote: one master laptop runs the voting server, six (or more) voting laptops act as kiosks, and one projector shows the reveal. All devices connect over the same local Wi-Fi. No internet, accounts, or sign-in needed.

**Do not use the GitHub Pages URL for the live vote.** GitHub Pages only serves static files and cannot run the local voting server or share the ballot between devices.

## What you need

- One "master" laptop to run the server and host the dashboard
- Voting laptops (one per class) and one projector (or display) to show results
- All devices on the same Wi-Fi network (not guest Wi-Fi with client isolation, and not networks that block device-to-device traffic)
- Node.js 18 or newer on the master laptop

## How to set up on any laptop

You must download the **entire repository** to each laptop you want to open locally. Do **not** download just `index.html` — other pages, CSS, JS, and the server code are required.

### Option 1: Git (recommended, easiest to update)
```sh
git clone https://github.com/heat-a11y/role-model-vote
cd role-model-vote
```

### Option 2: Download ZIP
1. Go to [github.com/heat-a11y/role-model-vote](https://github.com/heat-a11y/role-model-vote)
2. Click `Code → Download ZIP`
3. Unzip the folder on each laptop

## Start voting (master first)

1. **On the master laptop:** Open the unzipped folder in a terminal and run:
   ```sh
   npm install
   npm run serve
   ```
   Leave this terminal open for the entire vote. It will print local URLs and the IP addresses of the master laptop (e.g. `http://192.168.1.50:8080`).

2. **Open the master dashboard:** On the master laptop, open `http://localhost:8080/dashboard.html` in your browser.

3. **Set up the ballot:** On the Setup tab, enter the question, candidates, and all class names with their roll sizes.

4. **Connect voting laptops:** On each voting laptop, open a browser and go to:
   ```
   http://MASTER-LAPTOP-IP:8080/kiosk.html?class=CLASSNAME
   ```
   Replace `MASTER-LAPTOP-IP` with the IP shown in the master terminal (e.g. `192.168.1.50`). Replace `CLASSNAME` with the exact class name from setup (e.g. `3A`, `3B`). Confirm the correct class is shown.

5. **Connect the projector:** Open `http://MASTER-LAPTOP-IP:8080/reveal.html` on the projector/display.

6. **Run the vote:** Press **Open voting** on the master dashboard. All devices will update live. When a class finishes, seal it from the Classes tab after their kiosk shows **Connected** with no "waiting to sync" badge. Close voting when ready, then show the reveal.

## Tips for "works on every laptop"

- **Any OS works:** Windows, macOS, Linux, and most Chromebooks can run this. The only requirement on master is Node.js 18+. Other devices just need a modern browser (Chrome, Edge, Firefox, etc.).
- **No installation needed on voting devices:** Voting laptops and projector don't run Node — they just open web pages via the master's IP.
- **Network matters:** Use your normal school Wi-Fi, not guest Wi-Fi. Disable client isolation/AP isolation if enabled. If prompted, allow Node.js through the master laptop's firewall (on private/local network).
- **Connection drops are safe:** If a kiosk loses connection, it keeps votes locally and retries automatically. Wait for the sync badge to clear before sealing or announcing results.
- **Master must stay running:** The master laptop must stay on, awake, and the `npm run serve` terminal must remain open throughout the vote.

## Data & privacy

- Votes and ballot are stored on the master laptop in `data/<ballot-id>.json`. The `data/` folder is created automatically.
- "Reset all votes" clears stored vote records and closes the ballot.
- There is no sign-in. Anyone on the same local network can access the dashboard — use a trusted private network and do not expose this server to the public internet.
- Each tap is one vote; the app does not identify pupils or prevent multiple taps.

## Development & checks

```sh
npm install           # needed for tests and CSS build
npm test              # local server and concurrent vote tests
npm run test:browser  # eight-device browser sync test
npm run test:render   # page layout and touch-target checks
npm run build         # rebuild css/app.css after changing HTML/JS
```

The server uses only Node.js built-in modules — you only need `npm install` if you want to run tests or rebuild CSS.
