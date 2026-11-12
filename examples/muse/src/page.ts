export function musePage(token: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="description" content="Muse — a living creative thought-space">
    <title>Muse · Living material</title>
    <style>html,body,#app{min-height:100%}body{margin:0;min-width:320px;background:#171714}</style>
    <link rel="stylesheet" href="/styles.css">
    <script>globalThis.__WEIV_PROPS__={token:${JSON.stringify(token)}};</script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/main.mjs"></script>
  </body>
</html>`;
}
