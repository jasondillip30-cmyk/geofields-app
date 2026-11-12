# Pilot receipt storage on Vercel

- Create a **Private** Blob store dedicated to the pilot project. Connect the store
  to that project's environment so the server receives `BLOB_READ_WRITE_TOKEN`.
  Do not use a public store or put the token in client-side variables.
- Set `RECEIPT_STORAGE=blob` explicitly on the pilot as well, so private storage
  is required even if Vercel system environment variables are not exposed.
- On Vercel, new receipt attachments use private Blob storage automatically.
  Missing configuration fails closed. The extractor runs in-process in Blob
  mode so remote artifact URLs do not bypass the private attachment route.
- The attachment URL is a GeoFields endpoint. The uploader (with a receipt-related
  permission) and users with finance view access may read it. The response is not
  cached. Local development uses the same endpoint with files under
  `tmp/private-receipts` (or `RECEIPT_LOCAL_STORAGE_DIR`) outside the public tree.
- Legacy receipt URLs are not migrated. Keep any old attachments out of the pilot
  until they can be imported into private storage. The existing live app is not
  changed by setting up the pilot.
- Before onboarding, upload a synthetic PDF and phone image to the pilot and
  verify the receipt still opens after a redeploy. Verify signed-out and unrelated
  non-finance users cannot open it. The existing server upload flow remains subject
  to [Vercel's request body limit](https://vercel.com/docs/functions/limitations#request-body-size).

Local regression: `node --import tsx scripts/test-private-receipt-storage.ts`.
