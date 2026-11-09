package com.autobingwa.app;

import java.util.Calendar;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

// Pure ports of parseMpesa, confirm.js and offerRules.js from the web app. No Android, no storage.
final class EngineRules {
    private EngineRules() {}

    // ---------- Phone numbers ----------
    private static final Pattern CANDIDATE = Pattern.compile("\\+?\\d[\\d\\s\\-*]{7,15}[\\d*]");

    static final class Phone {
        final String phone;
        final boolean masked;
        Phone(String phone, boolean masked) { this.phone = phone; this.masked = masked; }
    }

    static Phone normalizePhone(String token) {
        String t = (token == null ? "" : token).replaceAll("[\\s\\-().]", "");
        boolean masked = t.contains("*");
        String s = t.replaceFirst("^\\+", "");
        String local = "";
        if (s.matches("^254[17][\\d*]{8}$")) local = "0" + s.substring(3);
        else if (s.matches("^0[17][\\d*]{8}$")) local = s;
        else if (s.matches("^[17][\\d*]{8}$")) local = "0" + s;
        return local.isEmpty() ? null : new Phone(local, masked);
    }

    private static Phone findPhone(String text) {
        Matcher m = CANDIDATE.matcher(text == null ? "" : text);
        while (m.find()) {
            Phone n = normalizePhone(m.group());
            if (n != null) return n;
        }
        return null;
    }

    // ---------- M-Pesa SMS ----------
    static final class Mpesa {
        String code = "";
        double amount = 0;
        String phone = "";
        String name = "";
        String account = "";
        String type = "till"; // mpesa | paybill | till
        boolean masked = false;
        boolean ok = false;
        String raw = "";
    }

    private static final Pattern CODE = Pattern.compile("^([A-Z0-9]{10})\\s+Confirmed", Pattern.CASE_INSENSITIVE);
    private static final Pattern AMOUNT = Pattern.compile("(?:ksh|kes)\\.?\\s*([\\d,]+(?:\\.\\d{1,2})?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern ACCOUNT = Pattern.compile("Account(?:\\s+Number)?\\s+(?!balance\\b)([A-Za-z0-9#\\-]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern FROM = Pattern.compile("\\bfrom\\s+(.+?)(?:\\s+on\\s+\\d|\\.\\s|\\.$|$)", Pattern.CASE_INSENSITIVE);
    private static final Pattern ACCOUNT_WORDS = Pattern.compile("Account(?:\\s+Number)?\\s+\\S+", Pattern.CASE_INSENSITIVE);

    static Mpesa parseMpesa(String text) {
        Mpesa p = new Mpesa();
        p.raw = (text == null ? "" : text).replaceAll("\\s+", " ").trim();
        Matcher cm = CODE.matcher(p.raw);
        if (!cm.find()) return p;
        p.code = cm.group(1).toUpperCase();
        if (!Pattern.compile("received", Pattern.CASE_INSENSITIVE).matcher(p.raw).find()) return p;

        Matcher am = AMOUNT.matcher(p.raw);
        if (!am.find()) return p;

        Matcher acc = ACCOUNT.matcher(p.raw);
        p.account = acc.find() ? acc.group(1) : "";
        Matcher fm = FROM.matcher(p.raw);
        String seg = fm.find() ? fm.group(1) : "";

        Phone found = findPhone(seg);
        if (found == null) found = findPhone(p.account);
        p.masked = found != null && found.masked;
        p.name = ACCOUNT_WORDS.matcher(CANDIDATE.matcher(seg).replaceAll(""))
            .replaceFirst("").replaceAll("\\s+", " ").trim();

        p.amount = Double.parseDouble(am.group(1).replace(",", ""));
        p.phone = (found != null && !p.masked) ? found.phone : "";
        if (Pattern.compile("you have received", Pattern.CASE_INSENSITIVE).matcher(p.raw).find()) p.type = "mpesa";
        else if (!p.account.isEmpty()) p.type = "paybill";
        else p.type = "till";
        p.ok = true;
        return p;
    }

    static String fillPhone(String ussd, String phone) {
        return Pattern.compile("\\bAB\\b", Pattern.CASE_INSENSITIVE)
            .matcher(ussd == null ? "" : ussd).replaceAll(Matcher.quoteReplacement(phone));
    }

    // ---------- Safaricom confirmations ----------
    static final class Conf {
        final String status;  // success | failed
        final String phone;   // may be null
        final String reason;  // "Already recommended" or null
        Conf(String status, String phone, String reason) { this.status = status; this.phone = phone; this.reason = reason; }
    }

    private static final int CI = Pattern.CASE_INSENSITIVE;
    private static final Pattern P_FAILED = Pattern.compile("recommendation\\s+failed|already\\s+been\\s+recommended", CI);
    private static final Pattern P_CUSTOMER = Pattern.compile("customer\\s+(\\d{9,12})", CI);
    private static final Pattern P_BINGWA = Pattern.compile("recommendation\\s+for\\s+(\\d{9,12})\\s+submitted\\s+successfully", CI);
    private static final Pattern P_BINGWA2 = Pattern.compile("recommendation\\b.{0,40}submitted\\s+successfully", CI);
    private static final Pattern P_OK = Pattern.compile("successfully\\s+recommended\\s+offer\\s+to\\s+(\\d{9,12})", CI);
    private static final Pattern P_THANKS = Pattern.compile("thank\\s+you\\s+for\\s+choosing\\s+safaricom", CI);
    private static final Pattern P_SCREEN_ERR = Pattern.compile(
        "connection\\s+problem|invalid\\s+mmi|invalid\\s+input|insufficient|not\\s+enough|unable\\s+to|failed|error|try\\s+again", CI);

    static Conf classifyConfirmation(String text) {
        String t = text == null ? "" : text;
        if (P_FAILED.matcher(t).find()) {
            Matcher p = P_CUSTOMER.matcher(t);
            return new Conf("failed", p.find() ? p.group(1) : null, "Already recommended");
        }
        Matcher b = P_BINGWA.matcher(t);
        if (b.find()) return new Conf("success", b.group(1), null);
        if (P_BINGWA2.matcher(t).find()) return new Conf("success", null, null);
        Matcher ok = P_OK.matcher(t);
        if (ok.find()) return new Conf("success", ok.group(1), null);
        if (P_THANKS.matcher(t).find()) return new Conf("success", null, null);
        return null;
    }

    // For USSD screens only: also catches ordinary error messages
    static Conf classifyScreen(String text) {
        Conf c = classifyConfirmation(text);
        if (c != null) return c;
        if (P_SCREEN_ERR.matcher(text == null ? "" : text).find()) return new Conf("failed", null, null);
        return null;
    }

    // ---------- Offer rules ----------
    private static int mins(String hhmm) {
        try {
            String[] parts = (hhmm == null || hhmm.isEmpty() ? "0:0" : hhmm).split(":");
            int h = Integer.parseInt(parts[0].trim());
            int m = parts.length > 1 ? Integer.parseInt(parts[1].trim()) : 0;
            return h * 60 + m;
        } catch (Exception e) {
            return 0;
        }
    }

    // tw = { on, from, until }. Windows that cross midnight work too.
    static boolean inWindow(JSONObject tw, long atMs) {
        if (tw == null || !tw.optBoolean("on", false)) return true;
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(atMs);
        int now = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        int a = mins(tw.optString("from", "0:0"));
        int b = mins(tw.optString("until", "0:0"));
        if (a == b) return true;
        return a < b ? (now >= a && now < b) : (now >= a || now < b);
    }

    static final class Pick {
        final JSONObject offer;
        final JSONObject primary; // set when the alternative offer was used
        Pick(JSONObject offer, JSONObject primary) { this.offer = offer; this.primary = primary; }
    }

    private static boolean sameId(Object a, Object b) {
        return String.valueOf(a).equals(String.valueOf(b));
    }

    static Pick pickOffer(JSONArray offers, double amount, long atMs) {
        if (offers == null) return null;
        java.util.ArrayList<JSONObject> same = new java.util.ArrayList<>();
        for (int i = 0; i < offers.length(); i++) {
            JSONObject o = offers.optJSONObject(i);
            if (o != null && o.optBoolean("enabled", false) && o.optDouble("price", -1) == amount) same.add(o);
        }
        if (same.isEmpty()) return null;

        java.util.ArrayList<JSONObject> open = new java.util.ArrayList<>();
        for (JSONObject o : same) if (inWindow(o.optJSONObject("tw"), atMs)) open.add(o);
        if (!open.isEmpty()) {
            for (JSONObject o : open) {
                JSONObject tw = o.optJSONObject("tw");
                if (tw != null && tw.optBoolean("on", false)) return new Pick(o, null); // a timed offer beats an untimed one
            }
            return new Pick(open.get(0), null);
        }
        for (JSONObject p : same) {
            JSONObject tw = p.optJSONObject("tw");
            Object id = tw == null ? null : tw.opt("altId");
            if (id == null || id == JSONObject.NULL || "".equals(id)) continue;
            for (int i = 0; i < offers.length(); i++) {
                JSONObject x = offers.optJSONObject(i);
                if (x != null && sameId(x.opt("id"), id) && x.optBoolean("enabled", false)
                        && inWindow(x.optJSONObject("tw"), atMs)) {
                    return new Pick(x, p);
                }
            }
        }
        return null;
    }
}