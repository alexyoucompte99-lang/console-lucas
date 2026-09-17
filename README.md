# Console Lucas · leads

Console de suivi des leads de Lucas Fabre (Leads and Business, mentorat 90 jours pour freelances tech, design et conseil). Même mécanique que la console Cyntia : une page unique qui lit et écrit en direct dans un Google Sheet via un pont Apps Script, avec repli local quand le pont ne répond pas.

- **Page live** : https://alexyoucompte99-lang.github.io/console-lucas/ (code d'accès `lucas26`, demandé une fois puis gardé dans le téléphone).
- **Un seul fichier** : `index.html` (DA de la LP du live : fond `#060a04`, vert néon `#a6ff4d`, Instrument Serif + Geist). Aucune donnée de lead dans le repo : tout vient du pont.
- **Pont Apps Script** : dossier `pont/` (clasp, compte alexyoucompte99 par défaut). Données dans le Google Sheet « Console Lucas · leads » (onglet Leads) créé par le pont, id posé dans les ScriptProperties par `what=setup`. Clé du pont dans `pont/pont-key.txt` (gitignoré) et dans `index.html`.
- **Inscrits au live** : le pont lit le Sheet « Live Leads and Business · Inscriptions » (`1G-v7_Ow_jLJtu1lVMRCpsPdecrBVTBabMA71lqVPA-8`, onglet Inscriptions, en-têtes ligne 1, données à partir de la ligne 3) par nom de colonne.

## Onglets
1. **Leads** : une fiche par lead (nom, source, date du call, statut, qualifié /10, besoin, objection, action suivante + date de relance, prix proposé, encaissé, notes). Filtres par statut avec compteurs, recherche, relances échues en rouge en tête. Ajout par le bouton « + Nouveau lead », édition en place (chaque changement part au pont, upsert par id).
2. **Calls à venir** : Aujourd'hui / Demain / Plus tard, bouton WhatsApp de confirmation (message court, tutoiement, signé Alex) si un numéro est saisi, plus les calls passés à renseigner.
3. **Ventes** : par mois, calls faits, show-up, ventes, taux de closing, CA proposé / encaissé, liste des vendus.
4. **Inscrits au live** : lecture du Sheet des inscriptions, bouton « → Créer le lead » qui préremplit le formulaire (source Live, cas dans Besoin / situation).

## Mise en route (une fois, à faire par Alex dans son Chrome)
Le pont ne fonctionne qu'après l'autorisation OAuth du compte alexyoucompte99. Ouvrir cette URL, cliquer « Vérifier les autorisations », choisir le compte, « Paramètres avancés » → « Accéder à Pont Console Lucas », accepter :

```
https://script.google.com/macros/s/AKfycbxYA0m2mWxXPoHFcPHDt-5N-sqrs2sHQw_YyoIM7g_5UX1V7Eg4Gji0rIBTXNy649g0dA/exec?key=lucas-759dc1a01a28ae1d91ac25c8&what=setup
```

La réponse JSON donne l'URL du Sheet créé (`sheet_url`) et `inscrits: true` si le Sheet du live est lisible. Si l'autorisation ne se déclenche pas depuis l'URL : ouvrir l'éditeur du script (https://script.google.com/d/1p7uyiieWBYfuY1-qQSHgNfMsPuna0HHWJmcfPiez2WJZ5LOMj3J0axzd/edit), lancer la fonction `autoriser` (en tête de fichier), accepter, puis rouvrir l'URL ci-dessus.

Les leads saisis avant l'autorisation restent dans le téléphone (file d'attente) et partent au pont dès qu'il répond.

## Endpoints du pont
- GET `?key=…&what=all` : tous les leads. `what=inscrits` : inscrits au live. `what=setup` : crée le Sheet si besoin.
- POST `{ key, what: 'upsert', lead: {…} }` (crée sans id, met à jour avec id), `{ what: 'delete', id }`, `{ what: 'all' }`, `{ what: 'inscrits' }`, `{ what: 'setup' }`.

## Modifier le pont
```
cd pont && clasp push -f && clasp redeploy AKfycbxYA0m2mWxXPoHFcPHDt-5N-sqrs2sHQw_YyoIM7g_5UX1V7Eg4Gji0rIBTXNy649g0dA -d "desc"
```
Jamais `clasp deploy` (nouvelle URL). Piège connu : `clasp create-script` écrase `appsscript.json` (fuseau, bloc webapp, scopes), le réécrire avant push. Si les scopes changent : relancer `autoriser()` dans l'éditeur.

## Test local
```
python3 -m http.server 8967 --directory . &
```
puis http://127.0.0.1:8967/ (sans pont, la page passe en « hors ligne · copie locale » et garde tout en localStorage).

## iClosed (16/09/2026)
Le pont synchronise les réservations iClosed de Lucas (API publique, clé dans les ScriptProperties `ICLOSED_KEY`, copie locale `pont/iclosed-key.txt` gitignorée).
Une fiche par personne, les champs iClosed ne remplissent que les cases vides, le statut n'est changé que s'il n'a pas été modifié à la main (colonne « iClosed statut auto »).
La console lance `what=sync` après chargement si la dernière synchro date de plus de 10 min ; bouton « Synchro iClosed » dans Calls à venir. Podcast et recrutement ignorés.

## Refonte closing (16/09/2026)
- Onglets : Aujourd'hui (objectifs du mois, goulot, à remplir, calls du jour, relances, demain à confirmer, remplir l'agenda), Leads, Calls, Chiffres, Inscrits live.
- Résultat en 1 clic : Follow-up = relance J+1 puis J+2, J+3, J+7 à chaque WhatsApp envoyé ; No-show = recaler le jour même ; Vendu = montant demandé.
- « Envoyer un par un » pour les relances du jour et la réactivation des anciens leads (> 45 j).
- Réglages (⚙) partagés via le pont : objectifs, signature, lien iClosed, 6 messages WhatsApp à variables.
- Automatisations : `.github/workflows/cron.yml` toutes les 15 min appelle `what=cron` (secrets PONT_URL, PONT_KEY) : synchro iClosed, Telegram @AlexTodoRecapBot (nouveau call booké, annulation, brief 8h, calls du jour non remplis 20h). Token Telegram dans les ScriptProperties (what=tg_setup).

## Refonte v2 (17/09/2026) : un suivi par call
Inspirée des consoles Thomas (closing), Anaïs (Selfty), Lauric et Developpia (Facette + Créno).
- **Onglet Calls du Sheet** : une ligne par call (réservation iClosed `icc<id>` ou call ajouté dans la console `c…`). Colonnes : Présence (present / noshow / reporte / annule), Résultat (vendu / followup / perdu / non_qualifie), Qualifié /10, Température, Offre, Prix, Paiement (comptant / 2x / 3x / 4x / autre), Encaissé, Objections (séparées par « · »), Pourquoi pas signé, Prochaine étape, Relance le, Enregistrement, Notes, Rempli le, Confirmation envoyée, Réponse confirmation. La synchro iClosed crée les calls, rafraîchit date et état, et ne remplit un résultat que si la case est vide. Les « Accompagnement 1to1 » sont des séances client (hors stats de vente).
- **Fiche résultat** (Aujourd'hui › À remplir, Calls, fiche lead) : ce qui s'est passé, puis résultat, qualif, objections en boutons (obligatoires si follow-up ou pas vendu), offre, prix, paiement et encaissé si vendu (date de vente = date du call), température, prochaine étape, date de relance ou 2e call si follow-up, nouveau créneau si reporté, enregistrement, notes. Brouillon gardé dans le téléphone. « Remplir un par un ». No-show en 1 clic. La fiche lead suit toute seule (statut, relance, prix, objection), sauf si un call plus récent existe.
- **Périodes** partagées par Aujourd'hui, Calls et Chiffres : Mois en cours, 2 mois précédents, Tout, Autre mois. Flèches par rapport au mois précédent (à la même date pour le mois en cours).
- **Calls** : passés (filtres par résultat avec compteurs, type R1 / suivi / séance client, tri, recherche, « ce qu'il reste à faire » sur chaque call) et à venir (confirmation + réponse : Confirmé / Veut décaler / Pas de réponse).
- **Leads** : filtres statut + source + température, tri (prochaine action, dernier call, récents, qualif, montant, nom), pills « à vérifier » (sans prochaine action, sans numéro, vente sans montant), historique des calls, ajout d'un call, note datée, statut « Écarté » (hors stats et relances) au lieu de supprimer.
- **Chiffres** : 8 tuiles cliquables, chaîne réservation → vente, mois par mois, par source, objections, qualification et closing, show-up selon le délai de réservation, effet des confirmations, reste à encaisser (échéancier 2x/3x/4x, bouton Reçu), ventes, récap à envoyer à Lucas.
- **Relances** : un message par étape (relance 1, relance 2 qui reprend l'objection, relance 3, dernière relance), rappel 1 h avant le call, réactivation différente selon que le lead a déjà parlé à Lucas ou non. Envoi un par un en 2 temps (ouvrir WhatsApp, puis « Envoyé, suivant »), toujours dans le même onglet WhatsApp.
- **Aujourd'hui** : plan du mois (ventes, calls tenus et calls bookés nécessaires pour l'objectif), encaissements en retard, leads à vérifier.
- **Heure de Paris** partout dans la page (Intl), quel que soit le fuseau du téléphone.
- **Pont** : `call_upsert` (`create:true` pour un nouveau call, sinon jamais de ligne créée), `call_delete`, `brief_preview` (texte du brief et du message du soir, sans envoi). Telegram : vente enregistrée, brief 8 h calculé sur les calls (confirmations, follow-ups sur la table, jours sans vente sur 90 jours).
