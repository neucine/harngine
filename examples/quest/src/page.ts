export function page(apiToken: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="description" content="A living social constellation of real museum objects">
    <title>Quest · The Museum of Nearby Things</title>
    <style>:root{--night:#121815;--forest:#1d2823;--paper:#f0eadb;--cream:#faf6eb;--ink:#17201d;--gold:#d5ad5c;--rust:#9b4c3d;--sage:#91a99a;--line:#d8cfbb}*{box-sizing:border-box}html,body,#app{min-height:100%}body{margin:0;min-width:320px;background:var(--night);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}button,input,textarea,select{font:inherit}</style>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <div id="app" data-token="${apiToken}"></div>
    <script type="module" src="/main.mjs"></script>
  </body>
</html>`;
}
