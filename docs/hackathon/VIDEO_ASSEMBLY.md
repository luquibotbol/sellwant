# Genuine demo recording and assembly

Prepared November 8, 2026 UTC. No final video exists. All slots below are
missing footage until the browser/payment/runtime roles provide actual files.
The release role did not control the browser, approve terms, attest handoff,
send email, record payment or upload media.

Target: 160 seconds, English narration. The planned narration is in
[DEMO_SUBMISSION_DRAFT.md](DEMO_SUBMISSION_DRAFT.md). Rules/access evidence is in
[RELEASE_READINESS.md](RELEASE_READINESS.md).

## Clip manifest

| Output interval | Suggested filename | Required actual screen/evidence | State |
| --- | --- | --- | --- |
| 0:00–0:20 | `01-marketplace.mp4` | Synthetic active ticket and separate buyer/seller goals | Missing |
| 0:20–0:55 | `02-reviewed-terms.mp4` | Real AI draft and both people's exact reviewed approvals | Missing; human steps |
| 0:55–1:25 | `03-durable-negotiation.mp4` | Public offers, one persisted deal, independent runtime continuity | Missing; fixture approvals must be labeled synthetic |
| 1:25–1:45 | `04-checkout-hold.mp4` | Buyer PayPal sandbox approval and verified exact authorization | Missing; human checkout |
| 1:45–2:10 | `05-handoff-capture.mp4` | Two distinct human handoffs and provider-confirmed completed capture | Missing; human attestations |
| 2:10–2:30 | `06-cancel-recovery.mp4` | Separate verified void, listing reopened and idempotent result | Missing; old standalone proof is not this integrated flow |
| 2:30–2:40 | `07-source-access.mp4` | Final public source/license and usable judge setup/access | Missing |

The filenames are reserved suggestions, not existing artifacts. Keep originals
and payment/model journals private and unchanged. Associate each raw clip with
its actual UTC start/end, originating role, scenario and evidence reference.
Never manufacture a screen state, receipt, payment, model response or approval.

## Capture handoff

Browser worker owns CUA and desktop recording. Keep the synthetic app scene
clean before capture. Hide passwords, API/capability tokens, private contacts,
other browser tabs and ticket codes. Record the actual human action separately
from the provider result. Stop before an account credential entry and resume
afterward. Leave the sandbox indicator and exact agreed amount visible.

Request from each role: the raw local file path, UTC interval, observed result,
and whether it depicts a real human action, synthetic fixture or read-only
verification. A screenshot may support documentation but cannot substitute for
the required functioning-app footage.

For scheduler continuity, a real elapsed-time cut may connect the enrollment
and reopened app with the same instance/action evidence. Label the time cut;
do not narrate a synthetic fixture mandate as a person's browser approval.
If the runtime cannot prove restart as well as continuous scheduling, use the
actual narrower wording instead of the draft's restart sentence.

## Assembly recipe

`ffmpeg`, `ffprobe` and `cloudflared` were not found on the current PATH during
the release check. No tool was installed. Editing can use an already-authorized
native recorder/editor or ffmpeg once available; do not start a public tunnel
as a substitute for verified hosted access.

After the real clips exist and the editor is available, normalize copies to
1280×720 at 30 fps with H.264/yuv420p and AAC audio. Trim only actual waiting,
retain the transition order and use hard cuts. Keep source media intact.
Example for one supplied raw clip (input/output are placeholders):

```sh
ffmpeg -i RAW_CLIP -ss START_SECONDS -t DURATION_SECONDS \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 48000 -ac 2 NORMALIZED_CLIP.mp4
```

When all normalized clips have matching streams, write their actual relative
filenames in `clips.txt` in the proven event order:

```text
file '01-marketplace.mp4'
file '02-reviewed-terms.mp4'
file '03-durable-negotiation.mp4'
file '04-checkout-hold.mp4'
file '05-handoff-capture.mp4'
file '06-cancel-recovery.mp4'
file '07-source-access.mp4'
```

```sh
ffmpeg -f concat -safe 1 -i clips.txt -c copy -movflags +faststart sellwant-demo.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 sellwant-demo.mp4
```

This recipe has not run. Mixed/no-audio clips need normalization before concat;
use human-approved narration and no unlicensed music. Do not add synthetic
speech that impersonates a person. Rewatch the complete export with sound,
check exact amounts/statuses and redactions, and verify duration below 180
seconds. Record the file hash and final duration after rendering.

## Publication check

After human review, upload through the authorized YouTube account as publicly
visible, inspect processing/completed playback from a clean logged-out browser,
and save the actual URL, duration and review timestamp. A local file, upload
acceptance or unlisted URL does not satisfy the public-video gate. Then enter
the verified link in the saved Devpost draft. No upload or entry occurred at
this checkpoint.
