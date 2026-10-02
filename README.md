# Role Model Vote

A simple, live school vote for one master laptop, six voting laptops, and one projector. The master
laptop runs the app and stores the ballot; every other device connects to it over the same local
Wi-Fi. No Firebase project, internet connection, accounts, or sign-in are needed.

**Run the app from the master laptop, not the GitHub Pages URL.** GitHub Pages only serves static
files and cannot run the local voting server or store the shared ballot.

## Start the voting server

Install Node.js 18 or newer on the master laptop. In this folder, run:

```bash
npm install
npm run serve
```

Keep this terminal open for the whole vote. It prints links for the master dashboard and the other
devices. Open `http://localhost:8080/dashboard.html` on the master laptop. Give the six voting
laptops their own class link, for example:

```text
http://MASTER-LAPTOP-IP:8080/kiosk.html?class=3A
http://MASTER-LAPTOP-IP:8080/kiosk.html?class=3B
```

Open `http://MASTER-LAPTOP-IP:8080/reveal.html` on the projector. Replace `MASTER-LAPTOP-IP` with
one of the addresses printed by `npm run serve`. All eight devices must be on the same Wi-Fi or
local network, and that network must allow devices to communicate with each other. Guest Wi-Fi or
client isolation can block this; test all eight devices in the room before voting day. Allow Node.js
through the master laptop's firewall on the private/local network if prompted.

## Run the vote

1. On the master dashboard's **Setup** tab, enter the question, candidates, and all six class names
   with their roll sizes.
2. Open each `kiosk.html?class=...` link on its assigned voting laptop. Confirm the displayed class
   is correct. Each tap is one vote; the kiosk confirms only after the master server has saved it.
3. Press **Open voting** on the master. The kiosks, dashboard, and projector receive live updates
   from the master server.
4. When a class finishes, wait for its kiosk to show **Connected** with no waiting-to-sync badge,
   then seal it on the **Classes** tab.
5. Close voting and open the projector's reveal. Save the results from the dashboard as a CSV/JSON
   and print a copy if needed.

The dashboard and projector update live using the local network. If a kiosk briefly loses its
connection, it keeps that vote on the kiosk and retries; wait for its sync badge to clear before
sealing classes or announcing the result. The master laptop must stay on and the server terminal
must remain running throughout.

## Data and privacy

The master stores the ballot and vote records in `data/<ballot-id>.json`, creating `data/` the first
time the dashboard is opened. Keep a copy of this file if you need an additional backup. **Reset all
votes** clears the stored vote records and closes the ballot.

There is no sign-in by design. Anyone able to access the voting server on that local network can
open the dashboard and change or reset the ballot. Use a trusted private network, and do not expose
the server to the public internet. Votes are stored on the master laptop, not sent to Firebase.

Each tap counts as a vote; the app does not identify pupils or prevent one pupil from tapping more
than once. Class totals can be compared with roll sizes to spot over-voting.

## Development and checks

```bash
npm test               # local server and concurrent vote tests
npm run test:browser   # eight-device browser sync test
npm run test:render    # page layout and touch-target checks
npm run build          # rebuild css/app.css after changing HTML/JS classes
```

The server uses only Node.js built-in modules. `npm install` is needed for the browser/render tests
and CSS build, not to run the voting server.
