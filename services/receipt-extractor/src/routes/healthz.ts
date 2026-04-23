export async function handleHealthz() {
  return Response.json({
    ok: true,
    service: "receipt-extractor",
    time: new Date().toISOString()
  });
}
