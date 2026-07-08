# Electricity bill alerts

Notify a user (push) when a **new monthly electricity bill** is generated for a
saved connection.

## How it works

1. A signed-in user saves a connection (DISCO + reference/customer-id) — from the
   bill screen's 🔔 action or the **Bill alerts** screen. Rows go to
   `electricity_connections` (Supabase, RLS owner-only), written directly by the
   app like its other synced tools.
2. The app registers the device's **FCM token** in `push_tokens`.
3. The backend watcher (`src/services/billWatch.ts`, started from `index.ts`)
   runs every 6h: for each connection it re-fetches the bill via the same parser
   the `/api/bill` route uses, and when `billMonth` advances past
   `last_notified_month`, it sends a push to that user's tokens and records the
   month — so each new bill fires **exactly once**.

The whole pipeline runs today **except the actual push send**, which is dormant
until an FCM service account is configured (`pushConfigured()` is false → sends
are skipped, state is still recorded). Complete the two setup blocks below to
light it up.

## 1. Apply the migration

Run `supabase/migrations/0018_bill_alerts.sql` (Supabase SQL editor or
`supabase db push`). Adds `electricity_connections` + `push_tokens` with RLS.

## 2. Backend: FCM service account

- Firebase console → **Project settings → Service accounts → Generate new
  private key** → downloads a JSON.
- Put the **entire JSON on one line** into the backend env:
  ```
  FCM_SERVICE_ACCOUNT={"type":"service_account","project_id":"…", … }
  ```
  (`firebase-admin` is already a dependency; `push.ts` reads this var lazily.)
- Restart the backend. Log should read `[billWatch] started (every 6h)` without
  the "push dormant" suffix.

## 3. App: Firebase + token registration

The Flutter side intentionally has **no Firebase dependency yet** so the app
keeps building without config files. To enable push:

### 3a. Firebase project + config files
- Create/attach a Firebase project; add the Android app (package id from
  `android/app/build.gradle`) and iOS app.
- Android: drop `google-services.json` into `android/app/`, add the
  `com.google.gms.google-services` Gradle plugin.
- iOS: add `GoogleService-Info.plist`, enable Push Notifications + Background
  Modes (remote notifications), and upload an **APNs auth key** in the Firebase
  console. Easiest: run `flutterfire configure` (generates `firebase_options.dart`).

### 3b. pubspec
```yaml
dependencies:
  firebase_core: ^3.6.0
  firebase_messaging: ^15.1.3
```

### 3c. Init + register the token
`main.dart`, before `runApp`:
```dart
await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
```

Add `lib/core/notifications/push_registration.dart`:
```dart
import 'package:firebase_messaging/firebase_messaging.dart';
import 'dart:io' show Platform;
import 'package:supabase_flutter/supabase_flutter.dart';

/// Registers this device's FCM token in `push_tokens` for the signed-in user so
/// the backend bill-watcher can push to it. Call after sign-in and on launch
/// (when signed in); also re-register on token refresh.
class PushRegistration {
  static Future<void> sync() async {
    final client = Supabase.instance.client;
    final user = client.auth.currentUser;
    if (user == null) return;
    final fm = FirebaseMessaging.instance;
    await fm.requestPermission();
    final token = await fm.getToken();
    if (token == null) return;
    await client.from('push_tokens').upsert({
      'token': token,
      'user_id': user.id,
      'platform': Platform.isIOS ? 'ios' : 'android',
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  static void listen() {
    FirebaseMessaging.instance.onTokenRefresh.listen((_) => sync());
    // Foreground messages: surface via the existing local-notification service.
    FirebaseMessaging.onMessage.listen((m) {
      final n = m.notification;
      if (n != null) {
        NotificationService.instance.showNow(
          title: n.title ?? '', body: n.body ?? '');
      }
    });
  }
}
```
Wire it: call `PushRegistration.sync()` after sign-in and on launch (if signed
in), and `PushRegistration.listen()` once at startup. Add a `showNow(...)`
helper to `NotificationService` if one doesn't exist. On sign-out, delete the
device's row from `push_tokens`.

> Note: bill alerts require sign-in (subscriptions are keyed by `user_id`). The
> **Bill alerts** screen already shows a sign-in-required state for guests.

## Tuning
- Poll cadence: `everyMs` in `billWatch.ts` (default 6h).
- Message copy: `notifyNewBill()` in `billWatch.ts`.
- First alert: when a connection is saved from a viewed bill, the app seeds
  `last_notified_month` to the current month, so the first push is the *next*
  bill. Connections added without a viewed bill get an alert for the current
  bill on the next run.
