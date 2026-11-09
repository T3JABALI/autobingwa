package com.autobingwa.app;

import android.accessibilityservice.AccessibilityService;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.regex.Pattern;

public class UssdAccessibilityService extends AccessibilityService {
    private static final String TAG = "AutoBingwa";
    public static volatile UssdAccessibilityService instance;
    public static final LinkedBlockingQueue<Dialog> events = new LinkedBlockingQueue<>();
    private static volatile String lastText = "";
    private static volatile String lastLogged = "";
    private static volatile boolean active = false;
    private static volatile boolean progressSeen = false;
    // The reason the last typeAndSend failed. The flow puts it in the transaction's response.
    public static volatile String lastFail = "";

    // The last USSD window that was found, reused if Android stops listing it for a moment
    private volatile AccessibilityNodeInfo lastRoot = null;
    private volatile long lastNoWinLog = 0;

    // The input box and Send button of the newest dialog, found while reading it.
    // typeAndSend uses them directly so it does not have to search the screen again.
    private volatile AccessibilityNodeInfo cachedBox = null;
    private volatile AccessibilityNodeInfo cachedSend = null;
    private volatile String cachedFor = "";
    // A screen that did not look fully drawn yet; it must look the same on the next scan to count
    private String pendingText = "";

    // Only a pure progress window counts as progress. A real message that merely contains "please wait" does not.
    private static final Pattern PROGRESS = Pattern.compile(
        "^((ussd code running|running ussd code|ussd running|running|please wait|loading|sending request|sending|connecting)[\\s.\\u2026]*)+$");

    // While a transaction runs, also look at the USSD window this often
    private static final long POLL_MS = 30;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable scan = new Runnable() {
        @Override public void run() { scanNow(); }
    };
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!active) return;
            scanNow();
            handler.postDelayed(this, POLL_MS);
        }
    };

    public static class Dialog {
        public final String text;
        public final boolean hasInput;
        Dialog(String t, boolean i) { text = t; hasInput = i; }
    }

    // Called when a USSD run starts and ends
    public static void begin() {
        events.clear();
        lastText = "";
        lastLogged = "";
        lastFail = "";
        progressSeen = false;
        active = true;
        final UssdAccessibilityService s = instance;
        if (s != null) {
            s.lastRoot = null;
            s.cachedBox = null;
            s.cachedSend = null;
            s.cachedFor = "";
            s.pendingText = "";
            s.handler.removeCallbacks(s.poll); // never run two polling loops at once
            s.handler.post(new Runnable() {
                @Override public void run() { s.keyboardHidden(true); }
            });
            s.handler.post(s.poll);
        }
    }

    public static void end() {
        active = false;
        final UssdAccessibilityService s = instance;
        if (s != null) {
            s.handler.removeCallbacks(s.poll);
            s.handler.removeCallbacks(s.scan);
            s.cachedBox = null;
            s.cachedSend = null;
            s.handler.post(new Runnable() {
                @Override public void run() { s.keyboardHidden(false); }
            });
        }
    }

    // True if a "USSD code running" window was seen since the last value was sent
    public static boolean sawProgress() {
        return progressSeen;
    }

    // Keeps the on-screen keyboard from opening over the USSD dialog while a purchase runs.
    // It is switched back to normal as soon as the run ends.
    private void keyboardHidden(boolean hide) {
        if (Build.VERSION.SDK_INT < 24) return;
        try {
            AccessibilityService.SoftKeyboardController c = getSoftKeyboardController();
            if (c != null) {
                c.setShowMode(hide ? AccessibilityService.SHOW_MODE_HIDDEN : AccessibilityService.SHOW_MODE_AUTO);
            }
        } catch (Exception e) {
            Log.d(TAG, "keyboard mode not changed: " + e);
        }
    }

    @Override protected void onServiceConnected() { instance = this; }
    @Override public void onInterrupt() {}
    @Override public boolean onUnbind(android.content.Intent i) {
        keyboardHidden(false);
        instance = null;
        return super.onUnbind(i);
    }

    private boolean isOwnPkg(CharSequence p) {
        return p != null && p.toString().equalsIgnoreCase(getPackageName());
    }

    // The phone's own USSD window. AutoBingwa's own screens never count.
    private boolean isPhonePkg(CharSequence p) {
        if (p == null) return false;
        if (isOwnPkg(p)) return false;
        String s = p.toString().toLowerCase(Locale.ROOT);
        return s.contains("phone") || s.contains("dialer") || s.contains("telecom")
            || s.contains("incall") || s.contains("ussd");
    }

    // A window from an unknown package still counts if it looks like a USSD dialog:
    // an input box and Android's own positive (Send) button.
    private boolean looksLikeUssd(AccessibilityNodeInfo r) {
        if (r == null || isOwnPkg(r.getPackageName())) return false;
        return findEditable(r) != null && byId(r, "android:id/button1") != null;
    }

    private AccessibilityNodeInfo phoneRoot() {
        StringBuilder seen = new StringBuilder();
        try {
            for (AccessibilityWindowInfo w : getWindows()) {
                AccessibilityNodeInfo r = w.getRoot();
                if (r == null) continue;
                seen.append(r.getPackageName()).append(' ');
                if (isPhonePkg(r.getPackageName()) || looksLikeUssd(r)) { lastRoot = r; return r; }
            }
        } catch (Exception e) {
            // fall through to the active window
        }
        AccessibilityNodeInfo r = getRootInActiveWindow();
        if (r != null) {
            seen.append("active=").append(r.getPackageName());
            if (isPhonePkg(r.getPackageName()) || looksLikeUssd(r)) { lastRoot = r; return r; }
        }
        // Android did not list the window, but it may still be there
        AccessibilityNodeInfo last = lastRoot;
        if (last != null) {
            try {
                if (last.refresh()) return last;
            } catch (Exception e) {
                // the window is gone
            }
        }
        long nowMs = System.currentTimeMillis();
        if (active && nowMs - lastNoWinLog > 1500) {
            lastNoWinLog = nowMs;
            Log.d(TAG, "no USSD window; Android listed: " + (seen.length() == 0 ? "nothing" : seen.toString().trim()));
        }
        return null;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (!active) return;
        if (e.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            Log.d(TAG, "window changed to " + e.getPackageName() + " / " + e.getClassName());
        }
        if (!isPhonePkg(e.getPackageName()) && isOwnPkg(e.getPackageName())) return;
        // Look right away. A burst of events collapses into one look.
        handler.removeCallbacks(scan);
        handler.post(scan);
    }

    private static boolean isButtonWord(String t) {
        String s = t.trim().toLowerCase(Locale.ROOT);
        return s.equals("send") || s.equals("cancel") || s.equals("ok") || s.equals("reply") || s.equals("dismiss");
    }

    private void scanNow() {
        if (!active) return;
        AccessibilityNodeInfo root = phoneRoot();
        if (root == null) return;
        StringBuilder sb = new StringBuilder();
        boolean[] input = { false };
        walk(root, sb, input);
        String text = sb.toString().trim();
        if (text.isEmpty()) return;

        String norm = text.replace('\n', ' ').trim().toLowerCase(Locale.ROOT);
        boolean progress = !input[0] && PROGRESS.matcher(norm).matches();
        if (!text.equals(lastLogged)) {
            lastLogged = text;
            Log.d(TAG, "USSD window input=" + input[0] + " progress=" + progress + " text=" + text.replace('\n', ' '));
        }
        if (progress) { progressSeen = true; pendingText = ""; return; }

        if (text.equals(lastText)) return; // the same dialog again, not a new screen

        // A fully drawn dialog has its button (and its input box, when it asks for input).
        // Those are found once here and kept for typeAndSend.
        AccessibilityNodeInfo box = input[0] ? findEditable(root) : null;
        AccessibilityNodeInfo send = sendButton(root);
        boolean complete = send != null && (!input[0] || box != null);
        if (!complete && !text.equals(pendingText)) {
            pendingText = text; // maybe half drawn: it must look the same on the next scan
            return;
        }
        pendingText = "";
        lastText = text;
        cachedBox = box;
        cachedSend = send;
        cachedFor = text;
        events.offer(new Dialog(text, input[0]));
    }

    // The text of the USSD window on screen right now ("" if none)
    public String currentText() {
        AccessibilityNodeInfo root = phoneRoot();
        if (root == null) return "";
        StringBuilder sb = new StringBuilder();
        walk(root, sb, new boolean[] { false });
        return sb.toString().trim();
    }

    private void walk(AccessibilityNodeInfo n, StringBuilder sb, boolean[] input) {
        if (n == null) return;
        String cls = n.getClassName() == null ? "" : n.getClassName().toString();
        if (cls.endsWith("EditText") || n.isEditable()) input[0] = true;
        else if (!cls.endsWith("Button") && n.getText() != null && n.getChildCount() == 0
                 && !isButtonWord(n.getText().toString())) {
            sb.append(n.getText()).append('\n');
        }
        for (int i = 0; i < n.getChildCount(); i++) walk(n.getChild(i), sb, input);
    }

    private AccessibilityNodeInfo findEditable(AccessibilityNodeInfo n) {
        if (n == null) return null;
        String cls = n.getClassName() == null ? "" : n.getClassName().toString();
        if (cls.endsWith("EditText") || n.isEditable()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = findEditable(n.getChild(i));
            if (r != null) return r;
        }
        return null;
    }

    private AccessibilityNodeInfo byId(AccessibilityNodeInfo root, String id) {
        try {
            List<AccessibilityNodeInfo> l = root.findAccessibilityNodeInfosByViewId(id);
            if (l != null && !l.isEmpty()) return l.get(0);
        } catch (Exception e) {
            // fall back to text matching
        }
        return null;
    }

    private AccessibilityNodeInfo byText(AccessibilityNodeInfo n, String... names) {
        if (n == null) return null;
        CharSequence t = n.getText() != null ? n.getText() : n.getContentDescription();
        if (t != null && (n.isClickable() || (n.getClassName() != null && n.getClassName().toString().endsWith("Button")))) {
            String s = t.toString().trim().toLowerCase(Locale.ROOT);
            for (String name : names) if (s.equals(name)) return n;
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = byText(n.getChild(i), names);
            if (r != null) return r;
        }
        return null;
    }

    // Last resort: the first enabled Button that is not Cancel / Dismiss / Close
    private AccessibilityNodeInfo anyPositiveButton(AccessibilityNodeInfo n) {
        if (n == null) return null;
        String cls = n.getClassName() == null ? "" : n.getClassName().toString();
        if (cls.endsWith("Button") && n.isEnabled()) {
            String s = n.getText() == null ? "" : n.getText().toString().trim().toLowerCase(Locale.ROOT);
            if (!s.equals("cancel") && !s.equals("dismiss") && !s.equals("close")) return n;
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = anyPositiveButton(n.getChild(i));
            if (r != null) return r;
        }
        return null;
    }

    private AccessibilityNodeInfo sendButton(AccessibilityNodeInfo root) {
        AccessibilityNodeInfo b = byId(root, "android:id/button1"); // the positive button: Send / OK
        if (b == null) b = byText(root, "send", "ok", "reply");
        if (b == null) b = anyPositiveButton(root);
        return b;
    }

    private boolean click(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo cur = n;
        for (int i = 0; i < 4 && cur != null; i++) {
            if (cur.isClickable() && cur.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            cur = cur.getParent();
        }
        return n.performAction(AccessibilityNodeInfo.ACTION_CLICK);
    }

    private String boxText(AccessibilityNodeInfo box) {
        try { box.refresh(); } catch (Exception e) { /* keep going */ }
        CharSequence t = box.getText();
        return t == null ? "" : t.toString().trim();
    }

    // Puts the value straight into the box WITHOUT focusing it, so the keyboard never opens.
    // Only if that is refused does it focus the box and paste (the keyboard is hidden anyway during a run).
    private boolean setText(AccessibilityNodeInfo box, String value) {
        Bundle b = new Bundle();
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
        if (box.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)) return true;
        try {
            box.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("ab", value));
            return box.performAction(AccessibilityNodeInfo.ACTION_PASTE);
        } catch (Exception e) {
            return false;
        }
    }

    // Fast path: the box and button were found while the dialog was read, so use them directly.
    // Returns false when anything looks off, and the normal path then searches the screen again.
    private boolean fastTypeAndSend(String value) {
        AccessibilityNodeInfo box = cachedBox;
        AccessibilityNodeInfo send = cachedSend;
        if (box == null || send == null || !cachedFor.equals(lastText)) return false;
        long t0 = System.currentTimeMillis();
        Bundle b = new Bundle();
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
        if (!box.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)) return false; // old node, dialog moved on
        if (!boxText(box).equals(value)) return false; // the normal path waits for it properly
        if (!click(send)) return false;
        progressSeen = false;
        lastFail = "";
        Log.d(TAG, "typeAndSend fast '" + value + "' took " + (System.currentTimeMillis() - t0) + "ms");
        return true;
    }

    // Types the value into the USSD dialog and presses Send. On failure, lastFail says why.
    public boolean typeAndSend(String value) {
        if (fastTypeAndSend(value)) return true;

        AccessibilityNodeInfo root = phoneRoot();
        if (root == null) { lastFail = "no USSD window found"; return false; }
        AccessibilityNodeInfo box = findEditable(root);
        AccessibilityNodeInfo send = sendButton(root);
        Log.d(TAG, "typeAndSend pkg=" + root.getPackageName() + "/" + root.getClassName() + " box=" + (box != null) + " send=" + (send != null));
        if (box == null) { lastFail = "input box not found"; return false; }
        if (send == null) { lastFail = "Send button not found"; return false; }

        boolean set = setText(box, value);
        Log.d(TAG, "typeAndSend setText=" + set);
        if (!set) { lastFail = "the input box refused the text"; return false; }

        // One quick check that the text is really in the box. Only if it is not, wait a little and try again.
        if (!boxText(box).equals(value)) {
            long end = System.currentTimeMillis() + 200;
            while (!boxText(box).equals(value) && System.currentTimeMillis() < end) {
                try { Thread.sleep(10); } catch (InterruptedException e) { break; }
            }
            if (!boxText(box).equals(value)) {
                setText(box, value);
                try { Thread.sleep(30); } catch (InterruptedException e) { /* continue */ }
            }
        }

        // Press Send right away. Only if that fails, look the button up again (the dialog may have redrawn).
        boolean clicked = click(send);
        if (!clicked) {
            AccessibilityNodeInfo root2 = phoneRoot();
            AccessibilityNodeInfo send2 = root2 != null ? sendButton(root2) : null;
            clicked = send2 != null && click(send2);
        }
        Log.d(TAG, "typeAndSend clicked=" + clicked);
        if (!clicked) { lastFail = "the Send button did not respond"; return false; }
        progressSeen = false; // from here, any progress window belongs to this step
        lastFail = "";
        return true;
    }

    // Closes whatever USSD window is open. Never touches AutoBingwa's own screens.
    public void dismiss() {
        AccessibilityNodeInfo root = phoneRoot();
        if (root == null) return;
        AccessibilityNodeInfo b = byId(root, "android:id/button2"); // Cancel, when there is an input box
        if (b == null) b = byId(root, "android:id/button1");        // OK on a final message
        if (b == null) b = byText(root, "cancel", "ok", "dismiss", "close");
        if (b == null || !click(b)) performGlobalAction(GLOBAL_ACTION_BACK);
    }
}