# Offline drilling pilot

This is an installable field screen, not an offline copy of the dashboard.
Prepare the offline screen on the device and browser profile that will be
used in the field. If adding it to the Home Screen, open that icon and
prepare again there before going offline.

1. Sign in while connected, open **Offline drilling** from project Spending
   or the project detail page, and choose **Prepare or refresh field setup**.
   Confirm **Ready for offline use** and check the project and rig are listed.
   Select a recent hole to fill its last recorded depth, or type a new hole.
   The downloaded depth is a hint; the server checks it again at sync.
2. Turn on airplane mode. Reopen the field screen and choose **Start report**.
   If you need to stop partway through, choose **Save draft**. Reopen the screen
   and select **Resume draft** to verify that the fields are still there.
   Drafts do not sync. Once the report is complete, select **Save to send**.
   Refresh again and verify it says **Saved on this phone** in the queue.
3. Reconnect and reopen the screen, or use **Sync now**. Check that the report
   is submitted once and appears in the normal approval queue, not in
   approved revenue. Repeat on the crew's iPhone and Android devices.

Only the field screen is cached. Project and rig choices and the report
queue are stored locally, not shared across devices. Use a personal device
or separate browser profile. The offline lock hides reports until the same
account prepares the kit again; it is not device-level encryption. Clearing
site data can erase unsynced work. Keep the screen open or reopen it when
signal returns; background sync while closed is not promised.
The field screen keeps one unfinished draft per account on this browser.

### Record time as the shift happens

- Pick the project, rig, shift date, Day or Night, and hole. Tap **Drilling**,
  **Delay**, or **Standby** whenever the activity changes. One activity runs at a
  time. Once timing starts, the log stays tied to that report's hole and shift.
- Each tap saves on the phone immediately. Lock the phone or close the browser,
  then select **Resume running shift** when you return. This uses recorded
  timestamps, not a timer that has to run in the background.
- Tap **Stop timing** and review the timeline. Edit an activity or add a missed
  one, then select **Fill report hours**. Drilling fills Work hours. Delay and
  Standby fill their own fields. You can still edit all three totals manually,
  and a delay still needs a reason. If the log changes, review and apply again.
- Enter depth and select **Save to send** yourself. Nothing sends because a
  timer was started or stopped. The timeline stays in the local draft; the
  server receives the reviewed totals through the existing approval flow.

The pilot does not capture inventory usage or attachments offline. The server
still checks the account, rig assignment, project status, depth continuity,
and billing setup. If those checks block a submission, the original report
stays on the phone for review. A project that closes before sync may require
an operational follow-up rather than an offline retry.

Before a production release, rehearse the single additive Prisma migration
on an isolated database and test the end-to-end Home Screen flow on real
phones against an HTTPS preview. Never submit synthetic drilling data to
production. If the offline shell changes, bump its cache version in
`public/offline-drilling-sw.js` so older phones pick up the new assets.
