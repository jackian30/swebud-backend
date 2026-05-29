# Chats and End-to-End Encryption

This document describes the current SweBudd chat feature and the beta end-to-end encryption foundation.

Current status: `0.2.23-beta`

## Chat surfaces

SweBudd currently has three chat surfaces:

- Direct buddy chats between mutual followers.
- Message requests when users are not mutual followers yet.
- Group buddies chats created from selected participants.

Group community chats also exist under groups/channels and use the group APIs, but the encrypted direct-message foundation described here is implemented on the direct buddy chat path.

The frontend Chat page also exposes this explanation in-app from the encryption info button so testers can read the same practical summary without opening repository docs.

## Direct buddy chat flow

Direct chats are allowed only when both users follow each other.

1. The frontend opens `/chat/buddy/:peerId`.
2. It loads `GET /chat/conversations/:peerId` for message history.
3. It opens the `/chat` Socket.IO namespace with the JWT in `auth.token`.
4. It sends messages through `POST /chat/messages` or the `chat:send` socket event.
5. The backend emits `chat:message` to the sender and recipient rooms.
6. The frontend upserts the message, decrypts encrypted payloads when possible, updates unread state, and marks active peer messages as read.

Unread state is tracked with `messages.read_at`; `PATCH /chat/conversations/:peerId/read` marks peer messages as read.

## Message requests

When users are not mutual followers, clients use `POST /chat/requests`.

- Pending requests appear from `GET /chat/requests`.
- Accepting a request copies the request body/reference into a normal message and marks the request accepted.
- Declining marks the request declined.
- If users become mutual followers while a request is pending, `acceptMutualRequests` automatically accepts it when conversations or requests are loaded.

The backend sends a `message_request` notification to the recipient when a new request is created.

## Group buddies chats

Group buddies chats are separate from direct chats and are stored as `buddy_group_chats`.

- `POST /chat/buddy-groups` creates a room and inserts members.
- `POST /chat/buddy-groups/:id/participants` adds members.
- `GET /chat/buddy-groups` lists rooms where the current user is a member.
- `GET /chat/buddy-groups/:id/messages` returns room messages.
- `POST /chat/buddy-groups/:id/messages` sends room messages.

Membership is enforced before reading, writing, or deleting room messages. Room messages are plaintext today.

## Realtime events

Socket namespace: `/chat`

Client-to-server:

- `chat:send` sends a direct message.
- `chat:typing` emits a typing indicator to a direct recipient.

Server-to-client:

- `chat:message`
- `chat:request`
- `chat:request-updated`
- `chat:buddy-group-updated`
- `chat:buddy-group-message`
- `chat:typing`

The socket handshake validates the JWT and joins the socket to a room named by the authenticated user id.

## Data model

Important Prisma models:

- `MessageRequest`: pending/accepted/declined request body plus optional ActSnap reference fields.
- `Message`: direct, group, or buddy-group message body plus optional reference fields, reactions, deletion fields, and encryption fields.
- `MessageReaction`: one reaction per user per message.
- `BuddyGroupChat` and `BuddyGroupChatMember`: room and membership data.
- `ChatProfileOverride`: local per-peer display name/photo override.
- `User.chatPublicKey` / `User.chatPrivateKey`: legacy direct-chat key fields kept for API/database compatibility. The current frontend no longer depends on these fields to send direct messages.

Encryption-related `Message` fields:

- `encrypted`: boolean marker.
- `ciphertext`: base64 AES-GCM ciphertext.
- `nonce`: base64 AES-GCM IV.
- `body`: placeholder text such as `[encrypted]` for encrypted direct messages.

## E2EE foundation

The current direct-chat encryption is implemented in the frontend with Web Crypto:

1. On opening Chats, the client checks for browser Web Crypto support and a logged-in user id.
2. Before sending a direct message, the client derives a stable per-conversation AES-GCM key from the sorted pair of participant user ids.
3. The plaintext is encrypted with a random 12-byte IV.
4. The backend stores only `ciphertext`, `nonce`, `encrypted=true`, and a placeholder body.
5. Any logged-in device for either participant can derive the same conversation key and decrypt locally.

This replaced the earlier browser-local ECDH key-pair bootstrap so users are not blocked by an "original device" or stale registered chat key when they sign in on another phone.

The backend does not decrypt encrypted direct messages. It stores and relays encrypted payload fields.

## Fallback behavior

If encryption is not ready because the browser does not expose Web Crypto, the frontend currently falls back to plaintext direct send except for errors that mean a message request is required.

If decryption fails, the frontend displays `[cannot decrypt]`.

## What is and is not protected

Protected by the current foundation:

- Direct buddy chat message text when browser Web Crypto is available.
- Stored direct-message body content for encrypted direct messages; the backend receives ciphertext plus nonce, not the readable text body.

Not protected by the current foundation:

- Direct-chat participants, timestamps, read state, reactions, deletion state, request status, and other message metadata.
- Chat media attachments and ActSnap reference media/text.
- Buddy group chats, group/channel chats, and buddy session room chats.
- Any plaintext fallback message sent when Web Crypto is unavailable or encryption fails.

## Important limitations

This is an MVP E2EE foundation, not production-audited secure messaging.

Known limitations:

- There is no key verification, safety number, fingerprint check, or trust-on-first-use warning.
- The per-conversation key is deterministic from participant ids so it is multi-device friendly, but it is not a production-grade secret-chat design.
- There is no forward secrecy or per-message ratchet.
- Message metadata, participants, timestamps, reactions, deletion state, and unread state are not encrypted.
- Group buddies chats and group/channel chats are plaintext today.

## Production hardening checklist

Before calling chat E2EE production-ready:

- Replace deterministic conversation-key derivation with explicit device keys and real multi-device key distribution.
- Add user-visible key verification/fingerprint UX.
- Add key change detection and warnings.
- Use an audited protocol design such as Signal's Double Ratchet rather than raw ECDH reuse.
- Add encrypted attachments and encrypted ActSnap references if those need confidentiality.
- Add browser automation tests for encrypted send/decrypt, key loss, key rotation, and plaintext fallback boundaries.
