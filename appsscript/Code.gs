/**
 * Mailt spelers die niet op training kwamen en zich niet hadden afgemeld.
 *
 * Draait onder fiscus@tam.nl, want de mail gaat over trainingsboetes. De
 * selectie maakt de Worker: die mailt alleen wie 24 uur onveranderd op
 * afwezig staat nadat de trainer de presentie heeft ingevuld. Dit script
 * haalt die lijst op, verstuurt, en vinkt af zodat niemand twee keer
 * hetzelfde bericht krijgt.
 *
 * Instellen (Projectinstellingen > Scripteigenschappen):
 *   WORKER_URL   https://aanwezigheid-sync.tam-floris.workers.dev
 *   ADMIN_CODE   het adminwachtwoord van de aanwezigheidsapp
 *   TEST_MAIL    optioneel, adres waar testberichten heen gaan
 *
 * Trigger: verstuurNietGekomen, dagelijks tussen 11 en 12 uur. De Worker
 * haalt de afmeldingen om 10:00 op, dus dan is de lijst van vandaag klaar.
 */

var BOETEBELEID = 'https://tam.nl/tennis/training/trainingsboetes';

// De vaste handtekening van fiscus@tam.nl. Wisselt het bestuur, dan zijn dit
// de drie regels die je aanpast.
var FISCUS_NAAM = 'Victor Miedema';
var FISCUS_BESTUUR = "Bestuur 'Approach'";
var FISCUS_TELEFOON = '06 37433101';

// Het TAM-logo, als PNG in de mail zelf. Een verwijzing naar een plaatje op
// internet blokkeren veel mailprogramma's, dit niet.
var LOGO_PNG = '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';

function logo_() {
  var blob = Utilities.newBlob(Utilities.base64Decode(LOGO_PNG), 'image/png', 'tam.png');
  return blob.setName('tamlogo');
}

function handtekeningHtml_() {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000">'
    + '<p style="margin:0 0 12px">Met TAMsche groet,</p>'
    + '<p style="margin:0 0 12px"><b>' + FISCUS_NAAM + '</b><br>'
    + 'h.t. fiscus der Tennisclub Albertus Magnus<br>' + FISCUS_BESTUUR + '</p>'
    + '<p style="margin:0 0 12px">Tennisclub Albertus Magnus<br>Postbus 1138<br>'
    + '9701 BC Groningen<br>'
    + '&#9993;: <a href="mailto:fiscus@tam.nl">fiscus@tam.nl</a><br>'
    + '&#128222;: ' + FISCUS_TELEFOON + '</p>'
    + '<p style="margin:0"><img src="cid:tamlogo" width="192" height="82" '
    + 'alt="Tennisclub Albertus Magnus"></p></div>';
}

function handtekeningTekst_() {
  return ['Met TAMsche groet,', '', FISCUS_NAAM,
          'h.t. fiscus der Tennisclub Albertus Magnus', FISCUS_BESTUUR, '',
          'Tennisclub Albertus Magnus', 'Postbus 1138', '9701 BC Groningen',
          'fiscus@tam.nl', FISCUS_TELEFOON].join('\n');
}

function eigenschap_(naam, verplicht) {
  var v = PropertiesService.getScriptProperties().getProperty(naam);
  if (!v && verplicht) throw new Error('Scripteigenschap ' + naam + ' ontbreekt');
  return v;
}

/** Praat met de Worker. */
function worker_(pad, lading) {
  var res = UrlFetchApp.fetch(eigenschap_('WORKER_URL', true) + pad, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(Object.assign({ code: eigenschap_('ADMIN_CODE', true) }, lading)),
    muteHttpExceptions: true,
  });
  var tekst = res.getContentText();
  if (res.getResponseCode() !== 200) throw new Error(pad + ' gaf ' + res.getResponseCode() + ': ' + tekst);
  return JSON.parse(tekst);
}

var DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
var MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
               'augustus', 'september', 'oktober', 'november', 'december'];

/** "2026-09-09" wordt "woensdag 9 september". */
function datumInWoorden_(iso) {
  var d = new Date(iso + 'T12:00:00');
  return DAGEN[d.getDay()] + ' ' + d.getDate() + ' ' + MAANDEN[d.getMonth()];
}

/** De groepsnaam bevat dag en tijd, die hoeven er niet nog een keer bij. */
function voornaam_(naam) {
  return String(naam || '').split(' ')[0];
}

/**
 * Bouwt onderwerp en tekst. Eén regel is één gemiste training.
 */
function bericht_(regel) {
  var wanneer = datumInWoorden_(regel.datum);
  var dag = wanneer.split(' ')[0];

  var onderwerp = 'Afwezig training ' + dag;

  var r = [];
  r.push('Beste ' + voornaam_(regel.speler) + ',');
  r.push('');
  r.push('Je stond ' + wanneer + ' ingedeeld voor ' + regel.groep + '. Je trainer heeft '
       + 'genoteerd dat je er niet was. Een afmelding hebben we niet teruggezien.');
  r.push('');
  r.push('Was je er niet? Meld je dan de volgende keer op tijd af. Dat kan tot 9 uur '
       + "'s ochtends op de dag van de training, via de site of de app. Je training komt dan "
       + 'vrij en een ander lid kan hem overnemen. Daar help je iemand mee.');
  r.push('');
  r.push('Wat het kost als je je niet afmeldt: 5 euro per keer, tot maximaal drie keer per '
       + 'trainingsmoment. Dat is 15 euro bij een training per week en 30 euro bij twee. Mis '
       + 'je deze trainingsronde niet meer dan drie trainingen van een trainingsmoment, dan '
       + 'worden de boetes kwijtgescholden. Het hele beleid lees je op ' + BOETEBELEID);
  r.push('');
  r.push('Was je er wel? Dan is er iets misgegaan bij de presentie. Neem even contact op met '
       + regel.trainer + ', want je trainer vult de presentielijst in.');

  // Onder het bericht komt de vaste handtekening van fiscus@tam.nl.
  var tekst = r.join('\n') + '\n\n' + handtekeningTekst_();
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;'
    + 'line-height:1.5;color:#000">'
    + r.map(function (p) {
        if (p === '') return '';
        return '<p style="margin:0 0 12px">' + p
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(BOETEBELEID, '<a href="' + BOETEBELEID + '">het boetebeleid</a>')
          .replace('kwijtgescholden', '<b>kwijtgescholden</b>') + '</p>';
      }).join('')
    + handtekeningHtml_() + '</div>';

  return { onderwerp: onderwerp, tekst: tekst, html: html };
}

function stuur_(adres, m) {
  GmailApp.sendEmail(adres, m.onderwerp, m.tekst, {
    htmlBody: m.html,
    name: 'Tennisclub Albertus Magnus',
    inlineImages: { tamlogo: logo_() },
  });
}

/**
 * De dagelijkse run. Haalt op, verstuurt, vinkt af.
 *
 * `droog` verstuurt niets en vinkt niets af, dan zie je in het logboek wie er
 * aan de beurt zou zijn.
 */
function verstuurNietGekomen(droog) {
  var vanaf = 0;
  var verstuurd = 0, zonderAdres = 0, mislukt = 0;

  while (true) {
    var res = worker_('/admin/niet-gekomen', { adressen: true, vanaf: vanaf });
    if (!res.regels.length) break;

    var gelukt = [];
    for (var i = 0; i < res.regels.length; i++) {
      var regel = res.regels[i];
      if (!regel.mail) {
        // Geen adres in Genkgo. Niet afvinken: dan blijft hij staan en zien we
        // hem morgen opnieuw, en kan iemand het adres aanvullen.
        Logger.log('GEEN ADRES: ' + regel.speler + ' (' + regel.datum + ')');
        zonderAdres++;
        continue;
      }
      if (droog) { Logger.log('ZOU MAILEN: ' + regel.speler + ' <' + regel.mail + '> ' + regel.datum); continue; }
      try {
        stuur_(regel.mail, bericht_(regel));
        gelukt.push(regel.sleutel);
        verstuurd++;
      } catch (e) {
        Logger.log('MISLUKT: ' + regel.speler + ': ' + e);
        mislukt++;
      }
    }
    if (gelukt.length) worker_('/admin/gemaild', { sleutels: gelukt });

    if (!res.rest) break;
    vanaf += res.regels.length;
  }

  var samenvatting = 'verstuurd ' + verstuurd + ', zonder adres ' + zonderAdres + ', mislukt ' + mislukt;
  Logger.log(samenvatting);
  return samenvatting;
}

/** Laat zien wie er aan de beurt is, zonder iets te versturen. */
function proefdraaien() {
  return verstuurNietGekomen(true);
}

/**
 * Stuurt één voorbeeldbericht naar TEST_MAIL, langs dezelfde opmaak en
 * dezelfde verzendfunctie als de echte run. Vinkt niets af.
 */
function testbericht() {
  var adres = eigenschap_('TEST_MAIL', true);
  var regel = {
    speler: 'Floris Bokx',
    datum: '2026-09-09',
    groep: 'Woensdag 17:30-19:00 Speelsterkte 4',
    trainer: 'Tijmen Kremer',
    keer: 1,
  };
  stuur_(adres, bericht_(regel));
  Logger.log('testbericht verstuurd naar ' + adres);
}

/** Zet de dagelijkse trigger. Eén keer draaien, daarna niet meer nodig. */
function zetTrigger() {
  var bestaand = ScriptApp.getProjectTriggers();
  for (var i = 0; i < bestaand.length; i++) {
    if (bestaand[i].getHandlerFunction() === 'verstuurNietGekomen') ScriptApp.deleteTrigger(bestaand[i]);
  }
  ScriptApp.newTrigger('verstuurNietGekomen').timeBased().atHour(11).everyDays(1).create();
  Logger.log('trigger gezet op 11 uur');
}
