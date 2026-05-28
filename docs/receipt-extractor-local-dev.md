# Receipt Extractor Local Dev (Remote Mode Verification)

This runbook makes the extractor service runnable locally and verifies the Next.js route can serve extraction through `remote` mode.

## 1) Extractor Service Env

Minimum:

```bash
PORT=4300
```

Optional:

```bash
EXTRACTOR_API_KEY=
EXTRACTOR_MAX_UPLOAD_MB=20
EXTRACTOR_MAX_LONG_EDGE_PX=3200
EXTRACTOR_JPEG_QUALITY=92
RECEIPT_QR_TRACE=0
```

## 2) Run Extractor Service

```bash
cd services/receipt-extractor
npm run dev
# or
npm run start
```

## 3) Verify Service Endpoints

Health check:

```bash
curl -i http://127.0.0.1:4300/healthz
```

Extract endpoint:

```bash
FILE="$(find ../../public/uploads/inventory-receipts -type f \( -name '*.jpg' -o -name '*.JPG' -o -name '*.jpeg' -o -name '*.png' \) | head -n 1)"
curl -i -X POST http://127.0.0.1:4300/extract-receipt \
  -F "receipt=@${FILE}" \
  -F 'context={"requestId":"local-smoke","source":"desktop_upload"}' \
  -F 'options={"mode":"full","trace":true}'
```

If `EXTRACTOR_API_KEY` is set, add:

```bash
-H "x-extractor-api-key: <your-key>"
```

## 4) Next.js Env for Remote Mode

Required:

```bash
RECEIPT_EXTRACTOR_MODE=remote
RECEIPT_EXTRACTOR_BASE_URL=http://127.0.0.1:4300
DATABASE_URL=...
AUTH_SECRET=...
```

Optional:

```bash
RECEIPT_EXTRACTOR_API_KEY=
RECEIPT_EXTRACTOR_TIMEOUT_MS=90000
RECEIPT_EXTRACTOR_RETRY_COUNT=1
```

## 5) Run Next.js in Remote Mode

From repo root:

```bash
RECEIPT_EXTRACTOR_MODE=remote \
RECEIPT_EXTRACTOR_BASE_URL=http://127.0.0.1:4300 \
npm run dev
```

## 6) Verify Next Extract Route Uses Remote

Authenticate and call extract:

```bash
BASE_URL="http://127.0.0.1:3000"
LOGIN_HEADERS="$(mktemp)"
curl -sS -D "$LOGIN_HEADERS" -o /tmp/login.json \
  -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@geofields.co.tz","password":"Admin123!"}'
COOKIE="$(grep -i '^set-cookie:' "$LOGIN_HEADERS" | sed -n 's/.*\(gf_session=[^;]*\).*/\1/p' | head -n 1)"
FILE="$(find public/uploads/inventory-receipts -type f \( -name '*.jpg' -o -name '*.JPG' -o -name '*.jpeg' -o -name '*.png' \) | head -n 1)"
curl -i -X POST "${BASE_URL}/api/inventory/receipt-intake/extract" \
  -H "Cookie: ${COOKIE}" \
  -F "receipt=@${FILE}"
```

## 7) Temporary Mode Logs To Confirm Serving Path

In local dev, Next now prints visible lines like:

```text
[inventory][receipt-intake][mode] route=extract mode=remote servedBy=remote remoteAttemptStatus=succeeded ...
```

Possible `servedBy` values:

- `local`
- `shadow_local`
- `remote`
- `remote_fallback_local`

For `scan-url`, the same style log is emitted with `route=scan-url`.
