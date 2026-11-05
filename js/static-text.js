// Texto estático de las páginas que pinta el JS (portada y calendario):
// visible sin JS y, mientras carga, bajo la capa de js/page-loading.js. Al
// pintar el contenido se retira; su <h1>, el único título de la página, queda
// como título para lectores de pantalla (`place(title)` lo coloca).
export function retireStaticText(block, place) {
  if (!block) return;
  const title = block.querySelector('h1');
  if (title) {
    title.classList.add('sr-only');
    place(title);
  }
  block.remove();
}
