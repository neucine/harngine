export function supportPage(token: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="description" content="Harngine customer support operations demo">
    <title>Harngine · Relay Support</title>
    <style>:root{--ink:#23312d;--muted:#66736e;--canvas:#f2f4f3;--paper:#ffffff;--line:#d8dedb;--green:#2e6251;--lime:#d8f49b;--amber:#9a5c1e;--red:#9c4839}*{box-sizing:border-box}html,body,#app{min-height:100%}body{margin:0;min-width:320px;background:var(--canvas);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}button,input,textarea{font:inherit}</style>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <div id="app" data-token="${token}"></div>
    <script type="module" src="/main.mjs"></script>
  </body>
</html>`;
}
