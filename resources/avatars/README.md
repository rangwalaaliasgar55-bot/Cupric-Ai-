# Avatar assets

Upstream lab uses Notionists-style SVG avatars (CC0 remix):
https://github.com/xevrion/ui-lab/tree/main/public/avatars

To vendor files locally:

```bash
mkdir -p public/resources/avatars
curl -sL https://raw.githubusercontent.com/xevrion/ui-lab/main/public/avatars/ava.svg -o public/resources/avatars/ava.svg
curl -sL https://raw.githubusercontent.com/xevrion/ui-lab/main/public/avatars/ben.svg -o public/resources/avatars/ben.svg
curl -sL https://raw.githubusercontent.com/xevrion/ui-lab/main/public/avatars/cara.svg -o public/resources/avatars/cara.svg
curl -sL https://raw.githubusercontent.com/xevrion/ui-lab/main/public/avatars/dev.svg -o public/resources/avatars/dev.svg
curl -sL https://raw.githubusercontent.com/xevrion/ui-lab/main/public/avatars/fay.svg -o public/resources/avatars/fay.svg
```

Large SVG blobs are optional for the video editor; Review Room can use initials until avatars are pulled.
