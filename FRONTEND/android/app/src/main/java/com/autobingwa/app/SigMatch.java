package com.autobingwa.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Finds the option number to type by what the option says. Same rules as pickOption in signature.js.
final class SigMatch {
    private static final Pattern LINE = Pattern.compile("^(\\d{1,2})(?:\\s*[:.)\\-]\\s*|\\s+)(.+)$");

    private SigMatch() {}

    static String norm(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
    }

    // each entry: { number, text }
    static List<String[]> parseMenu(String text) {
        List<String[]> out = new ArrayList<>();
        if (text == null) return out;
        for (String line : text.split("\n")) {
            Matcher m = LINE.matcher(line.trim());
            if (m.find()) out.add(new String[] { m.group(1), m.group(2).trim() });
        }
        return out;
    }

    private static boolean has(String[] list, String w) {
        for (String x : list) if (x.equals(w)) return true;
        return false;
    }

    // The number to type, or null when the option is not found or not unique (never guess)
    static String pick(String rawLabel, String screen) {
        String label = norm(rawLabel);
        if (label.isEmpty()) return null;
        List<String[]> opts = parseMenu(screen);
        String found = null;
        int count = 0;
        for (String[] o : opts) {
            if (norm(o[1]).equals(label)) { found = o[0]; count++; }
        }
        if (count == 1) return found;
        if (count > 1) return null;

        String[] want = label.split(" ");
        found = null;
        count = 0;
        for (String[] o : opts) {
            String[] have = norm(o[1]).split(" ");
            int shared = 0;
            for (String w : want) if (has(have, w)) shared++;
            boolean wantInHave = shared == want.length;
            boolean haveInWant = true;
            for (String h : have) if (!has(want, h)) { haveInWant = false; break; }
            if ((wantInHave || haveInWant) && shared >= Math.min(2, want.length)) { found = o[0]; count++; }
        }
        return count == 1 ? found : null;
    }
}