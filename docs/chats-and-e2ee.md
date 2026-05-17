# Chats and End-to-End Encryption

This document describes the current SweBudd chat feature and the beta end-to-end encryption foundation.

Current status: `0.2.3-beta`

## Chat surfaces

SweBudd currently has three chat surfaces:

- Direct buddy chats between mutual followers.
- Message requests when users are not mutual followers yet.
- Group buddies chats created from selected participants.

Group community chats also exist under groups/channels and use the group APIs, but the encrypted direct-message foundation described here is implemented on the direct buddy chat path.

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
- `User.chatPublicKey`: current registered public key for direct chat encryption.

Encryption-related `Message` fields:

- `encrypted`: boolean marker.
- `ciphertext`: base64 AES-GCM ciphertext.
- `nonce`: base64 AES-GCM IV.
- `body`: placeholder text such as `[encrypted]` for encrypted direct messages.

## E2EE foundation

The current direct-chat encryption is implemented in the frontend with Web Crypto:

1. On opening Chats, the client creates or loads an ECDH P-256 key pair from `localStorage`.
2. The public key is exported as JWK, base64-encoded, and registered with `POST /chat/keys`.
3. Before sending a direct message, the sender fetches the recipient public key with `GET /chat/keys/:peerId`.
4. The sender derives a shared AES-GCM 256-bit key from the sender private key and recipient public key.
5. The plaintext is encrypted with a random 12-byte IV.
6. The backend stores only `ciphertext`, `nonce`, `encrypted=true`, and a placeholder body.
7. Recipients derive the same AES-GCM key from their private key and the sender public key, then decrypt locally.

The backend does not decrypt encrypted direct messages. It stores and relays encrypted payload fields.

## Fallback behavior

If encryption is not ready or the recipient has not registered a public key, the frontend currently falls back to plaintext direct send except for errors that mean a message request is required.

If decryption fails, the frontend displays `[cannot decrypt]`. If a message was encrypted for another device/key, it displays `[encrypted for another device]`.

## Important limitations

This is an MVP E2EE foundation, not production-audited secure messaging.

Known limitations:

- Private keys are stored in browser `localStorage`.
- There is no key verification, safety number, fingerprint check, or trust-on-first-use warning.
- There is no multi-device key distribution.
- There is no forward secrecy or per-message ratchet.
- Public keys can be replaced server-side without client verification.
- Message metadata, participants, timestamps, reactions, deletion state, and unread state are not encrypted.
- Group buddies chats and group/channel chats are plaintext today.

## Production hardening checklist

Before calling chat E2EE production-ready:

- Move private key material to a stronger platform-backed storage strategy where available.
- Add user-visible key verification/fingerprint UX.
- Add key change detection and warnings.
- Add multi-device support with explicit device keys.
- Use an audited protocol design such as Signal's Double Ratchet rather than raw ECDH reuse.
- Add encrypted attachments and encrypted ActSnap references if those need confidentiality.
- Add browser automation tests for encrypted send/decrypt, key loss, key rotation, and plaintext fallback boundaries.
