export function page(apiToken: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="description" content="A living social constellation of real museum objects">
    <title>Quest · The Museum of Nearby Things</title>
    <style>html,body,#app{min-height:100%}body{margin:0;min-width:320px;background:#121815}</style>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <div id="app" data-token="${apiToken}"></div>
    <script type="module" src="/main.mjs"></script>
  </body>
</html>`;
}
