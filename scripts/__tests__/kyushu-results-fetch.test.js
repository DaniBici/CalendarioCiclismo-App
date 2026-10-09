import { describe, expect, it } from 'vitest';
import { parsePdf, resultsPdfFromPost, riderLine, seconds, sitemapEntries } from '../results-fetchers/kyushu-results-fetch.mjs';

// Comunicado sintético con la maquetación de pdftotext -layout de los comisarios.
const communique = (stage, date = '11 Oct 2026') => `
 Mynavi Tour de Kyushu 2026
COMMUNIQUE No.4-1-1                                                         ${date}
Stage Results Stage ${stage} SAGA-FUKUOKA / Stage ${stage} 佐賀・福岡                 Number of km: 150km
Pl. Num           UCI ID             Rider                             Team                          Time Behind Y
1    11     10000000011 ROSSI Marco / マルコ・ロッシ (ITA)           XAT XDS・アスタナ チーム             2:36'06"     0"
2     2     10000000002 PEETERS Jan / ヤン・ペーテルス (BEL)            IWA アンテルマルシェ・ワンティ            2:36'06"     0"    1
3    82     10000000082 TORIBIO ALCOLEA Jose Vicente / ホセ・ビセンテ・トリビオ・アル MTR マトリックスパワータグ   2:43'25"   7'19"
                         コレア (ESP)
OTL 164      10000000164 SHIRAKAWA Koki / 白川 幸希 (JPN)                    VCH ヴィクトワール広島                  2:59'41" 23'35"
DNF  4       10000000004 SATO Taro / 佐藤 太郎 (JPN)                         IWA アンテルマルシェ・ワンティ                      -
DNS 133      10000000133 DE BOD Stefan / ステファン・デ・ボッド (RSA)          TSG トレンガヌ・サイクリング・チーム            0:00'00"
                                                                                                    Panel of Commissaires
COMMUNIQUE No.4-2-1                                                         ${date}
General Individual Time Classification After Stage ${stage} / 個人総合成績 第${stage}ステージ          Total Distance: 300km
Pl. Num           UCI ID         Rider                                   Team   Stage ${stage}          Bns Pnl   Total       Behind Y
1    11    10000000011 ROSSI Marco / マルコ・ロッシ (ITA)                   XAT   (1)   2:36'06" 10"          5:25'09"     0'00"
2     2    10000000002 PEETERS Jan / ヤン・ペーテルス (BEL)                  IWA   (2)   2:36'06"  6"          5:25'13"     0'04" 1
3    82    10000000082 TORIBIO ALCOLEA Jose Vicente / ホセ・ビセンテ・トリビオ・アル MTR   (3) 2:43'25"     5:39'27"    14'18" 2
                         コレア (ESP)
                                                                                                    Panel of Commissaires
COMMUNIQUE No.4-3                                                           ${date}
Points Classification/ポイント賞 Stage ${stage} SAGA-FUKUOKA / Stage ${stage} 佐賀・福岡
General Individual Points Classification / ポイント賞総合 After Stage ${stage}
Pl. Num UCI ID                   Rider                              Team   Stage ${stage}        Pnl     Total
1     11    10000000011 ROSSI Marco / マルコ・ロッシ (ITA)                 XAT         25                    50
2      2    10000000002 PEETERS Jan / ヤン・ペーテルス (BEL)                IWA         20                    33
                                                                                                    Panel of Commissaires
COMMUNIQUE No.4-4                                                           ${date}
General KOM Classification / 山岳賞総合成績 After Stage ${stage}
Pl. Num        UCI ID                Rider                                      Team    Stage ${stage}       Pnl   Total
 1    82 1000000008          TORIBIO ALCOLEA Jose Vicente / ホセ・ビセンテ・トリビオ・アル  MTR      10        12
                             コレア (ESP)
 2    11 1000000001          ROSSI Marco / マルコ・ロッシ (ITA)                    XAT                 5
                                                                                                    Panel of Commissaires
COMMUNIQUE No.4-5                                                           ${date}
General Team Time Classification / チーム総合成績 After Stage ${stage}
Pl.          Team                                                       Stage ${stage}       Total Behind
     1    XAT XDS ASTANA TEAM / XDS・アスタナ チーム                        7:48'18"   16:19'39"
     2    IWA INTERMARCHÉ - WANTY / アンテルマルシェ・ワンティ                    7:49'17"   16:20'22"     0'43"
     -    MTR MATRIX POWERTAG / マトリックスパワータグ
                                                                                                    Panel of Commissaires
`;

const options = { year: 2026, competitionId: -15065, expectedDate: '2026-10-11', totalStages: 3 };

describe('kyushu-results-fetch', () => {
  it('lee tiempos y filas con el nombre partido en dos líneas', () => {
    expect(seconds(`2:36'06"`)).toBe(9366);
    expect(seconds(`7'19"`)).toBe(439);
    expect(seconds('0"')).toBe(0);
    expect(seconds('-')).toBeNull();
    const rider = riderLine(`3    82     10000000082 TORIBIO ALCOLEA Jose Vicente / ホセ・ビセンテ・トリビオ・アル MTR マトリックスパワータグ   2:43'25"   7'19"`);
    expect(rider).toMatchObject({ rank: 3, bib: '82', uciId: '10000000082', name: 'TORIBIO ALCOLEA Jose Vicente', team: 'MTR' });
  });

  it('emite llegada, general, puntos, montaña, jóvenes y equipos', () => {
    const { stage, final } = parsePdf(communique(2), { ...options, stageNumber: 2 });
    expect(final).toBeNull();
    const byKind = Object.fromEntries(stage.classifications.map((item) => [item.classKind, item]));
    expect(stage.classifications.every((item) => item.publication.format === 'pdf')).toBe(true);
    expect(byKind.stage.rows.map((row) => [row.bib, row.rankText, row.resultValue])).toEqual([
      ['11', '1', '2:36:06'], ['2', '2', '+00'], ['82', '3', '+7:19'],
      ['164', 'OTL', null], ['4', 'DNF', null], ['133', 'DNS', null],
    ]);
    expect(byKind.stage.rows[0]).toMatchObject({ riderDisplay: 'ROSSI Marco', uciId: '10000000011', teamName: 'XAT - XDS ASTANA TEAM' });
    expect(byKind.gc.rows.map((row) => [row.bib, row.resultValue])).toEqual([['11', '5:25:09'], ['2', '+04'], ['82', '+14:18']]);
    expect(byKind.youth.rows.map((row) => [row.rank, row.bib, row.resultValue])).toEqual([[1, '2', '5:25:13'], [2, '82', '+14:14']]);
    expect(byKind.points.rows.map((row) => [row.bib, row.points])).toEqual([['11', 50], ['2', 33]]);
    expect(byKind.kom.rows.map((row) => [row.bib, row.points])).toEqual([['82', 12], ['11', 5]]);
    expect(byKind.teams.rows.map((row) => [row.teamName, row.resultValue])).toEqual([
      ['XAT - XDS ASTANA TEAM', '16:19:39'], ['IWA - INTERMARCHÉ - WANTY', '+43'],
    ]);
  });

  it('añade la clasificación final en la última etapa', () => {
    const { final } = parsePdf(communique(3), { ...options, stageNumber: 3 });
    expect(final.isFinalClassification).toBe(true);
    expect(final.classifications.map((item) => item.classKind)).toEqual(['gc', 'points', 'kom', 'youth', 'teams']);
    expect(final.classifications.every((item) => item.scope === 'stage')).toBe(true);
  });

  it('rechaza otra etapa, otra fecha o una diferencia que no cuadra', () => {
    expect(() => parsePdf(communique(2), { ...options, stageNumber: 1 })).toThrow(/etapa 2, no a la 1/);
    expect(() => parsePdf(communique(2, '12 Oct 2026'), { ...options, stageNumber: 2 })).toThrow(/2026-10-12/);
    expect(() => parsePdf(communique(2).replace(`14'18" 2`, `14'19" 2`), { ...options, stageNumber: 2 })).toThrow(/no cuadra/);
  });

  it('descubre el comunicado por el título del aviso y el año del PDF', () => {
    const post = (title, href) => `<title>${title} | マイナビ ツール・ド・九州２０２６</title><a href="${href}">PDF</a>`;
    const pdf = 'https://tourdekyushu.asia/manager/wp-content/uploads/2026/10/C08.pdf';
    expect(resultsPdfFromPost(post('STAGE 2 熊本阿蘇 &#8211; リザルトのお知らせ', pdf), 2, 2026)?.url).toBe(pdf);
    expect(resultsPdfFromPost(post('STAGE 2 Kumamoto Aso – Results', pdf), 2, 2026)?.url).toBe(pdf);
    expect(resultsPdfFromPost(post('STAGE 2 熊本阿蘇 – スタートリスト決定のお知らせ', pdf), 2, 2026)).toBeNull();
    expect(resultsPdfFromPost(post('STAGE 3 宮崎 – リザルトのお知らせ', pdf), 2, 2026)).toBeNull();
    expect(resultsPdfFromPost(post('STAGE 2 熊本阿蘇 – リザルトのお知らせ', pdf.replace('/2026/', '/2025/')), 2, 2026)).toBeNull();
    const xml = '<urlset><url><loc>https://tourdekyushu.asia/news/1/</loc><lastmod>2026-10-10T20:48:28+09:00</lastmod></url>'
      + '<url><loc>https://tourdekyushu.asia/news/2/</loc><lastmod>2026-10-11T14:18:18+09:00</lastmod></url></urlset>';
    expect(sitemapEntries(xml, '2026-10-11').map((entry) => entry.url)).toEqual(['https://tourdekyushu.asia/news/2/']);
  });
});
