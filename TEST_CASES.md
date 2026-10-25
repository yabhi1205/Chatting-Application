# Chat test cases

Run the automated Socket.IO checks with:

```sh
yarn test
```

The automated suite checks:

1. A code message keeps its sender identity after reconnecting with the same browser identity.
2. An upload can be cancelled after a chunk is sent, and files over 5 GB are rejected.
3. A small file reaches another room member in chunks and its temporary server copy is removed after delivery.
4. A message over 5 MB is broadcast live and omitted from persisted history.
5. The chat markup and styles contain the mobile member list, cancel control, and leave-room control.

## Browser checks

The automated suite does not run a browser engine. Before release, check these flows in a desktop browser and a narrow mobile viewport:

1. Join from two browsers and confirm both names appear in the desktop roster and mobile “Here now” strip.
2. Send multiline code, copy it, and paste it elsewhere. Confirm the code toggle resets after sending.
3. Send a photo, video, and a general file. Confirm each room member receives it, previews work for photos/videos, and the file can be downloaded.
4. Start a large file upload, select **Cancel send**, and confirm the upload stops, no message is delivered, and another upload can start afterward.
5. Reconnect the same tab and confirm the name is retained and old messages from that browser are still marked “You”.
6. Select **Leave room** and confirm the app returns home and the participant disappears from the other member’s roster.
7. Send text larger than 5 MB. Confirm the warning appears once, current members see the message, and a later joiner does not.
8. Try a file above 5 GB and confirm it is rejected before uploading.
