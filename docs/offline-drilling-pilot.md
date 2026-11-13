# Offline drilling pilot

This is an installable field screen, not an offline copy of the dashboard.
Prepare the offline screen on the device and browser profile that will be
used in the field. If adding it to the Home Screen, open that icon and
prepare again there before going offline.

1. Sign in while connected, open **Offline drilling** from project Spending
   or the project detail page, and choose **Prepare or refresh field setup**.
   Confirm **Ready for offline use** and check the project and rig are listed.
2. Turn on airplane mode. Close the screen, reopen it from the Home Screen,
   fill a report, and select **Save report on this phone**. Close and reopen
   again to verify that the saved report is still waiting to sync.
3. Reconnect and reopen the screen, or use **Sync now**. Check that the report
   is submitted once and appears in the normal approval queue, not in
   approved revenue. Repeat on the crew's iPhone and Android devices.

Only the field screen is cached. Project and rig choices and the report
queue are stored locally, not shared across devices. Use a personal device
or separate browser profile. The offline lock hides reports until the same
account prepares the kit again; it is not device-level encryption. Clearing
site data can erase unsynced work. Keep the screen open or reopen it when
signal returns; background sync while closed is not promised.

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
