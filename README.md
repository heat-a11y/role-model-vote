# Role Model Vote

Live voting for a school. Six class laptops let pupils tap a favourite role model; one master
laptop shows the result updating in real time and saves a signed record of every vote.

- `index.html` &mdash; pick which screen this laptop is
- `kiosk.html` &mdash; the voting screen used in each classroom
- `dashboard.html` &mdash; the master's results and controls

---

## How it works

There is no server of your own. The app is static files on GitHub Pages, and all the live data
lives in **Firestore** in a free Firebase project. Each class laptop is an independent kiosk; they
all read and write the same ballot in the cloud. The master laptop watches that same ballot.

Every vote goes through a Firestore **transaction**, which means two classes tapping at the same
millisecond cannot overwrite each other. Every vote also writes one individual signed record
alongside the counters, so the master dashboard can prove the live numbers match the votes actually
cast.

No external CDNs are used. Tailwind is compiled to a real stylesheet and the Firebase SDK is served
from `vendor/`, so the app renders identically even on a slow or filtered school network. The only
network dependency is reaching Firestore itself.

---

## Setup, once, about thirty minutes

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and add a project.
2. On the project home, click the web icon (`</>`) to add a **Web app**. Do not tick Firebase
   Hosting. Register the app.
3. Firebase shows you a `firebaseConfig` object. Keep it open.

### 2. Turn on the two ways of signing in

Go to **Build &rarr; Authentication &rarr; Get started**, then **Sign-in method**:

- **Anonymous** &mdash; set to **Enable**, then **Save**. This is what the six class laptops use.
- **Email/Password** &mdash; set to **Enable**, then **Save**. Then go to the **Users** tab, click
  **Add user**, and create the teacher account, for example:

  ```
  email:    yourteacher@school.org
  password: something you will remember on the day
  ```

  Remember that email. You will type it into the dashboard to unlock the controls.

If the console offers to turn on **Google Cloud Identity Platform**, accept it. Newer projects need it
and without it every sign-in fails with `CONFIGURATION_NOT_FOUND`, which is the single most common
reason a fresh Firebase project refuses to work.

Check it worked with:

```bash
npm run test:live
```

It signs in anonymously against your real project and tells you exactly what is still missing.

### 3. Add the project keys

Open `js/firebase-config.js` and replace every `REPLACE_WITH_...` value with the matching value from
your `firebaseConfig`. It looks like this:

```js
export const firebaseConfig = {
    apiKey: 'AIza...',
    authDomain: 'yourproject.firebaseapp.com',
    projectId: 'yourproject',
    storageBucket: 'yourproject.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:abc123'
};
```

Until every placeholder is gone the app shows a red **setup required** screen instead of pretending
to work. It will never quietly fall back to a fake mode.

These values are safe to commit and safe to have on a school laptop. A Firebase web `apiKey` is
meant to be visible in any browser app; it is an identifier, not a password. What actually stops
anyone from tampering with your vote is the security rules in the next-but-one step, so those matter
far more than hiding the key.

### 4. Allow your domain

In **Authentication &rarr; Settings &rarr; Authorised domains**, add the address you will serve the
app from. `localhost` is already allowed. Add your GitHub Pages address too, for example
`yourrepo.github.io`.

### 5. Publish the Firestore security rules

The rules keep the class laptops honest: they may only add one vote, only while the vote is open.
They cannot rename candidates, retitle the ballot, change the class list or clear results. Only
your signed-in teacher account can do that.

First, open `firestore.rules` and put your teacher email into the marked line:

```
function ADMIN_EMAIL() {
    return 'yourteacher@school.org';
}
```

Then publish. Either in the console (**Firestore Database &rarr; Rules &rarr; Publish**), or from a
terminal:

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # pick your project
firebase deploy --only firestore:rules
```

### 6. Put it on GitHub Pages

```bash
git init
git add .
git commit -m "Role model vote"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

Then in the repository on GitHub: **Settings &rarr; Pages &rarr; Source: Deploy from a branch**,
branch `main`, folder `/ (root)`. Wait for the green tick, then your site is at
`https://YOUR-USERNAME.github.io/YOUR-REPO/`.

If you would rather not use GitHub Pages, `npm run serve` runs it on your laptop and prints the
address to open on the other six.

---

## Rehearse before the day

Do this at least once, in the actual room, on the actual Wi-Fi. It takes ten minutes and it is the
difference between a smooth day and a lost result.

1. On the master laptop open the dashboard and sign in with your teacher account.
2. **Setup** tab: type the question, replace the four **Example Role Model** names with the real
   candidates, and add your classes with their roll sizes.
3. Press **Open voting**.
4. On two other laptops open `.../kiosk.html?class=3A` and `.../kiosk.html?class=3B`.
5. Tap a few votes on each. Watch the master dashboard move. Check the **Classes** tab shows the
   counts and the turnout bar.
6. Turn off the Wi-Fi on one kiosk and tap a vote. Confirm it says **Vote held on this laptop** and
   not **Vote recorded**. Turn Wi-Fi back on and confirm the amber badge clears and the dashboard
   catches up.
7. Press **Reset all votes** to clear your rehearsal.

---

## On the day

**Before the first lesson**

1. Master laptop: open the dashboard, sign in, confirm the candidates and classes are right.
2. Leave voting **closed** while you set up.
3. On each class laptop, open `.../kiosk.html?class=3A` (and so on), confirm the class name in the
   top right, and press F11 for full screen.
4. Check the header says **Connected** on all six. If it says **Offline** or **Setup needed**, fix
   that before you start.

**During the lessons**

- Press **Open voting** on the master. The six kiosks change by themselves, no refresh needed.
- Press **Close voting** whenever you want, for an announcement or a fire drill. The kiosks show
  *Voting is closed* and refuse taps. You can reopen freely.
- Watch the **Classes** tab for a class showing more votes than its roll size. That is a pupil
  tapping twice. You cannot prevent it, but you can see it.

**Announcing the result**

1. Press **Close voting**.
2. Press **Winner** for the big projector view. It says *tie* honestly rather than picking one.
3. Press **Results CSV** and **Full JSON** to save a copy, and **Print / PDF** for the paper copy.
4. Check the **Verification** tab says the counters and the signed records **Match**.

---

## Things worth knowing

**A pupil cannot be stopped from voting twice.** By design the kiosks are open and fast. The
dashboard shows votes per class against the roll size so an over-voting class is visible. If you
need one vote per pupil guaranteed, the flow has to change to a teacher releasing each vote, which
is slower.

**Votes survive a network drop.** If a kiosk loses the network, a tap is stored in that laptop's
browser and marked *Vote held*. It syncs by itself a few seconds after the network returns, and the
counting is idempotent, so it cannot be counted twice. A kiosk never says *Vote recorded* for a vote
that is not recorded.

**The amber badge is not decoration.** If a kiosk shows *n waiting to sync*, those votes are not in
the dashboard yet. Wait for the badge to clear before you announce anything.

**Verification is the honest check.** The **Verification** tab compares the live counter against the
individual signed records. If they disagree, normally a vote arrived while a laptop was offline. Fix
that first, then announce.

**Editing is locked while voting is open**, on purpose. Removing a candidate mid-session would
change the meaning of votes already cast. Close the vote to edit.

**Candidate names may use letters, numbers, `-` and `_` only.** Same for class names. Dots and
spaces are converted automatically so that a stray full stop can never corrupt a counter.

---

## Local development

```bash
npm install
npm run build          # rebuild css/app.css after editing any html or js
npm run serve          # http://localhost:8080, prints addresses for the other laptops
npm test               # voting logic tests
npm run test:browser   # end to end tests in a real browser
npm run test:render    # checks the pages really render: layout, colours, touch target sizes
```

`npm test` covers the counting logic against an in-memory Firestore, including a control case that
proves the tests would catch lost votes. `npm run test:browser` drives real Chromium through the
kiosk and the dashboard. `npm run test:render` fails if the styling silently stops applying, which
is the failure mode you would otherwise only discover in a classroom.

Edit candidates, classes or text in the app at runtime, not in the code. If you add Tailwind classes
you must run `npm run build`, because `css/app.css` is precompiled and the class scanner only sees
what is already written in the source files. Write class names out in full, never assembled from
pieces.

## Project layout

```
index.html          chooser
kiosk.html          class voting screen
dashboard.html      master results and controls
js/
  firebase-config.js  the only file you edit, your project keys
  firebase.js         init, sign-in, error messages in plain English
  store.js            the ballot, the vote transaction, the offline queue
  kiosk.js            kiosk screens and state machine
  dashboard.js        results, classes, verification, export
  confetti.js         self-contained, cannot fail to load
  ui.js               icons, CSV, download helpers
vendor/             Firebase SDK, served locally
css/app.css         compiled stylesheet, commit this
firestore.rules     what the kiosks are and are not allowed to do
```