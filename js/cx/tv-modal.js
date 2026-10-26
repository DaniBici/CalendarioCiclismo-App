// Emisiones CX embebibles (YouTube y el resto de la allowlist de
// broadcast-embed.js, salvo embeddable=false) en el modal de TV de carretera:
// el enlace conserva la URL externa y el clic lo abre en el reproductor
// integrado. El modal se carga al pulsar, para no sumar race-data-modal.js a
// la carga de Hoy y de la ficha.
import {getBroadcastEmbed} from '../broadcast-embed.js';
import {t} from '../i18n.js';
import {cxEsc as esc} from './presentation.js';

export function cxTvEmbedAttrs({url,category,embeddable}) {
  if(!getBroadcastEmbed(url,embeddable))return '';
  return ` data-tv-embed="1"${category?` data-tv-category="${esc(category)}"`:''}`;
}

// resolve(link) devuelve {race,dateKey,category} o null. La cabecera del modal
// lleva la prueba y, como subtítulo, la categoría y la fecha cuando constan.
export function cxOpenTvEmbed(event,resolve) {
  const link=event.target.closest('a[data-tv-embed]');
  const target=link&&resolve(link);
  if(!target)return false;
  event.preventDefault();
  event.stopPropagation();
  const label=target.category?t(`cx.category.${target.category}`):'';
  void import('../race-data-modal.js').then(({openBroadcastTvModal})=>
    openBroadcastTvModal({dateKey:target.dateKey||''},target.race,link.href,null,{label}));
  return true;
}
