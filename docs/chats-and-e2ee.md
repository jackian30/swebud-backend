# Chats and Encryption Status

This document describes the current SweBudd chat feature, the retirement of unsafe deterministic encryption, and the requirements for future end-to-end encryption.

Current status: `0.2.45-beta`

## Chat surfaces

SweBudd currently has three chat surfaces:

- Direct buddy chats between mutual followers.
- Message requests when users are not mutual followers yet.
- Group buddies chats created from selected participants.

Group community chats also exist under groups/channels and use the group APIs. All newly-created chat messages are plaintext until secure device-key distribution is implemented.

The frontend Chat page also exposes this explanation in-app from the encryption info button so testers can read the same practical summary without opening repository docs.

## Direct buddy chat flow

Direct chats are allowed only when both users follow each other.

1. The frontend opens `/chat/buddy/:peerId`.
2. It loads `GET /chat/conversations/:peerId` for message history.
3. It opens the `/chat` Socket.IO namespace with the JWT in `auth.token`.
4. It sends messages through `POST /chat/messages` or the `chat:send` socket event.
5. The backend emits `chat:message` to the sender and recipient rooms.
6. The frontend upserts the message, decrypts legacy encrypted rows when possible, updates unread state, and marks active peer messages as read.

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

The socket handshake validates the JWT, rechecks current moderation/ban state, and joins the socket to a room named by the authenticated user id.

## Data model

Important Prisma models:

- `MessageRequest`: pending/accepted/declined request body plus optional ActSnap reference fields.
- `Message`: direct, group, or buddy-group message body plus optional reference fields, reactions, deletion fields, and encryption fields.
- `MessageReaction`: one reaction per user per message.
- `BuddyGroupChat` and `BuddyGroupChatMember`: room and membership data.
- `ChatProfileOverride`: local per-peer display name/photo override.
- `User.chatPublicKey`: public-key registration retained for future migration work. There is no server-side private-key column or API field.

Legacy encryption-related `Message` fields retained for read compatibility:

- `encrypted`: boolean marker.
- `ciphertext`: base64 AES-GCM ciphertext.
- `nonce`: base64 AES-GCM IV.
- `body`: placeholder text such as `[encrypted]` for encrypted direct messages.

## Current encryption policy

SweBudd does not claim that new messages are end-to-end encrypted.

- New direct sends with `encrypted=true` are rejected by the backend.
- Encrypted message requests are rejected.
- New direct messages are stored as plaintext and clear any client-supplied ciphertext/nonce fields.
- Legacy encrypted rows retain `encrypted`, `ciphertext`, and `nonce` so compatible clients can attempt historical decryption.
- The public-key API returns and stores `chatPublicKey` only. Supplying `privateKey` is rejected by global request validation.
- The database migration `20260716143000_drop_chat_private_key` removes the former private-key column.

The retired design derived an AES key from public participant identifiers. Anyone with those identifiers could derive the same key, so that mechanism did not provide meaningful confidentiality and must not be used for new content.

## What is protected today

Authorization and transport protections still apply:

- Direct chats require the existing social/message-request rules and block checks.
- Group/channel message reads and message-ID actions require current group and private-channel access.
- HTTP and Socket.IO authentication reject actively banned accounts, including previously-issued sessions.
- Production clients must use HTTPS/WSS so plaintext content is encrypted in transit.

Message content remains visible to the backend and database operators. Participants, timestamps, read state, reactions, deletion state, request status, references, buddy/group messages, and attachments are not end-to-end encrypted.

## Requirements before enabling E2EE

Do not accept new encrypted payloads until the design includes:

- Per-device key pairs whose private keys never leave the device.
- Authenticated multi-device public-key distribution and device revocation.
- User-visible key verification, key-change warnings, and recovery behavior.
- An audited protocol such as Signal's Double Ratchet with forward secrecy and post-compromise security.
- Encrypted attachment/reference handling where confidentiality is required.
- Cross-device automation for enrollment, rotation, loss, revocation, send/decrypt, and downgrade prevention.

Until those controls exist, a clear plaintext contract is safer than presenting deterministic obfuscation as E2EE.
