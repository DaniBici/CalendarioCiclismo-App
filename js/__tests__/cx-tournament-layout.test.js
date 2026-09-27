import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';

const source=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');

describe('presentación continua de torneos en apps',()=>{
  it('iOS conserva fechas encima, sin filas mensuales ni identidad de torneo en las cards',()=>{
    const view=source('ios-app/CalendarioCiclismo/Views/Cyclocross/CyclocrossView.swift');
    const model=source('ios-app/CalendarioCiclismo/Services/CyclocrossAgendaModel.swift');
    expect(model.match(/enum CxAgendaRow[\s\S]*?\n}/)[0]).not.toContain('case month');
    expect(view).toContain('DateFormatting.formatDateLabel(date)');
    expect(view).toContain('showTournamentLink: tournament == nil');
    expect(view).toContain('showTournamentLink ? race.tournament : nil');
    expect(view).toContain('LazyVStack(spacing: 10)');
    expect(view).toContain('tournament != nil && row.id != model.rows.first?.id ? 6 : 0');
  });
  it('Android conserva fechas encima y el gesto mensual no fragmenta el torneo',()=>{
    const view=source('android-app/app/src/main/java/app/calendariociclismo/android/ui/cyclocross/CyclocrossScreen.kt');
    expect(view.match(/private sealed class AgendaRow[\s\S]*?\n}/)[0]).not.toContain('class Month');
    expect(view).toContain('DateFormatting.formatDateLabel(first.date)');
    expect(view).toContain('showTournamentLink = tournamentId == null');
    expect(view).toContain('if (showTournamentLink) race.tournament else null');
    expect(view).toContain('verticalArrangement = Arrangement.spacedBy(10.dp)');
    expect(view).toContain('if (tournamentId != null && first.key != rows.firstOrNull()?.key) 6.dp else 0.dp');
    // El gesto mensual solo se adjunta en la agenda general: el torneo muestra
    // todas sus pruebas juntas y ningún swipe lo fragmenta.
    expect(view).toContain('.then(if (tournamentId == null) Modifier.pointerInput(season)');
  });
  it('web mantiene el mismo espaciado al cruzar un mes, sin títulos mensuales',()=>{
    const css=source('css/ciclocross.css');
    expect(css).not.toContain('.cx-month-title');
    expect(css).toContain('.cx-tournament-list {display:flex;flex-direction:column;gap:16px}');
    expect(css).toContain('.cx-tournament-list .cx-day-races {gap:10px;padding-bottom:0}');
    expect(css).toContain('.cx-tournament-list {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}');
    expect(css).toContain('.cx-tournament-list .cx-day-races {grid-template-columns:minmax(0,1fr)}');
  });
});
