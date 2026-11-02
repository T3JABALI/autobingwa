import { createClient } from "@supabase/supabase-js";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const phone = (v: unknown) => {
  const p = String(v ?? "").replace(/[\s+-]/g, "").replace(/^254/, "0");
  return /^0[17]\d{8}$/.test(p) ? p : "";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const cid = decodeURIComponent(parts[1] ?? "");
    const action = parts[2];

    if (!cid) return json({ error: "Missing business ID" }, 400);

    const { data: biz, error: bizError } = await db
       .from("sitelinks")
       .select("business_id, site_name")
       .eq("username", cid.toLowerCase())
       .maybeSingle();

    if (bizError) throw bizError;
    if (!biz) return json({ error: "Business not found" }, 404);

    if (req.method === "GET" && !action) {
      const { data, error } = await db
        .from("plans")
        .select("id, name, cat, price")
        .eq("business_id", biz.business_id)
        .eq("on_site", true);
      if (error) throw error;
      return json({ biz: biz.site_name, offers: data ?? [] });

    }

    if (req.method === "POST" && action === "purchase") {
      let body;
      try { body = await req.json(); }
      catch { return json({ error: "Invalid request" }, 400); }

      const receive = phone(body?.receive);
      const pay = phone(body?.pay);
      if (!body?.offerId || !receive || !pay) {
        return json({ error: "Missing or invalid purchase details" }, 400);
      }

      const { data: plan, error } = await db
        .from("plans")
        .select("id, price, name")
        .eq("id", body.offerId)
        .eq("business_id", biz.business_id)
        .eq("on_site", true)
        .maybeSingle();

      if (error) throw error;
      if (!plan) return json({ error: "Invalid offer" }, 400);

      // TODO: start the M-Pesa STK push for plan.price on the "pay" number
      return json({ ok: true, plan: plan.name, amount: plan.price });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("Function error:", error);
    return json({ error: "Internal server error" }, 500);
  }
});