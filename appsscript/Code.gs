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

  var onderwerp = 'Je was ' + dag + ' niet op training en je had je niet afgemeld';

  var r = [];
  r.push('Beste ' + voornaam_(regel.speler) + ',');
  r.push('');
  r.push('Je stond ' + wanneer + ' ingedeeld voor ' + regel.groep + '. Je trainer heeft '
       + 'genoteerd dat je er niet was. Een afmelding hebben we niet teruggezien.');
  r.push('');
  r.push('Was je er wel? Dan is er iets misgegaan bij de presentie. Neem even contact op met '
       + regel.trainer + ', want je trainer vult de presentielijst in.');
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
  r.push('Met sportieve groet,');
  r.push('Bestuur 63 der Tennisclub Albertus Magnus');

  var tekst = r.join('\n');
  var html = r.map(function (p) {
    if (p === '') return '';
    return '<p style="margin:0 0 12px">' + p
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(BOETEBELEID, '<a href="' + BOETEBELEID + '">het boetebeleid</a>') + '</p>';
  }).join('');

  return { onderwerp: onderwerp, tekst: tekst, html: html };
}

function stuur_(adres, m) {
  GmailApp.sendEmail(adres, m.onderwerp, m.tekst, {
    htmlBody: m.html,
    name: 'Tennisclub Albertus Magnus',
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
