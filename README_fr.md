![dsh_multi_api — relais multi-canal de modèles pour DSH](docs/banner.jpg)

# dsh_multi_api

[简体中文](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README.md) · [English](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_en.md) · [日本語](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_ja.md) · [Español](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_es.md) · [Français](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_fr.md) · [Deutsch](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_de.md) · [Русский](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_ru.md) · [Português](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_pt.md)

[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2%2B-4B32C3)](https://github.com/deepseek-ai) [![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org) [![JavaScript](https://img.shields.io/badge/JavaScript-ESM%20%C2%B7%20no%20build-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Web-lightgrey) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Relais multi-canal de modèles pour [DeepSeek Harness](https://github.com/deepseek-ai) : rattachez un modèle logique à plusieurs points d'accès compatibles OpenAI, et basculez sans bruit dès qu'un canal épuise son quota, subit une limite de débit, perd sa clé ou échoue en amont.**

`dsh_multi_api` transpose dans le processus DSH la couche « canaux + mapping de modèles + bascule » de new-api. Il s'enregistre comme un `LlmAdapter` ordinaire derrière un fournisseur virtuel, `relay`. Les modèles configurés apparaissent dans le sélecteur de modèles de la conversation et se comportent exactement comme les modèles natifs.

- **Routage multi-canal** — un modèle logique peut s'appuyer sur autant de canaux que voulu ; tri par priorité, pondération au sein d'une priorité, candidat suivant en cas d'échec.
- **Bascule automatique** — quota épuisé, identifiants invalides, limite de débit, `5xx`, expiration de délai ou « ce point d'accès ne connaît pas ce modèle » déclenchent le changement. Une fois du contenu visible émis, plus aucune bascule : deux réponses ne sont jamais recollées.
- **Refroidissements récupérables** — 30 minutes pour un quota, 12 heures pour une clé invalide, `Retry-After` pour les limites de débit, backoff exponentiel pour les échecs répétés ; l'état survit aux redémarrages et se lève à la main.
- **Gestion visuelle** — ajouter et modifier des canaux, rattacher des modèles, tester la connectivité, récupérer la liste des modèles amont, et voir quel canal a servi chaque appel et combien de bascules il a fallu.
- **Les clés ne sortent pas** — stockées dans la couche d'identifiants de DSH, jamais dans un fichier de configuration, un journal ou un message d'erreur.

## Installation / mise à jour

Nécessite DeepSeek Harness `0.2.0-rc.2` ou plus récent (bureau ou web).

### Depuis DeepSeek Harness

Barre latérale gauche **Plugins → Add plugin** : choisissez le dossier de ce dépôt, ou collez l'URL Git dans le champ de recherche.

### Avec la CLI `dsh`

```sh
dsh plugin --profile desktop add git+https://github.com/XiaoCai-dev/dsh_multi_api.git
```

Depuis un dossier local (pour le développement) :

```sh
dsh plugin --profile desktop add /path/to/dsh_multi_api
```

Mettre à jour :

```sh
dsh plugin --profile desktop add git+https://github.com/XiaoCai-dev/dsh_multi_api.git
```

Désinstaller :

```sh
dsh plugin --profile desktop remove dsh_multi_api
```

Redémarrez DSH ; **Channel relay** apparaît dans la barre latérale gauche.

## Utilisation

| Entrée | Rôle |
| --- | --- |
| **Canaux** | Ajouter, modifier, supprimer des canaux : Base URL, clé d'API, priorité, poids, délai d'attente, et les modèles servis par ce canal (`logique` ou `logique=amont`). Actions en ligne : tester la connectivité, récupérer les modèles amont, lever le refroidissement. |
| **Routes de modèles** | Une carte par modèle logique, avec la chaîne de bascule (canal A → canal B) et l'identifiant réel du modèle derrière chaque canal ; les rattachements se gèrent ici. |
| **Appels et bascules** | Les 200 derniers appels : résultat (succès / bascule / tous les canaux en échec), modèle, durée totale, chaîne de canaux ; dépliez une ligne pour le code d'erreur et le temps de chaque tentative. |
| **Sélecteur de modèles** | Les modèles logiques configurés apparaissent sous le groupe `Channel relay` ; choisissez-en un. Les modèles adossés à plusieurs canaux portent un badge `×N`. |

### Démarrage rapide

1. **Canaux → Ajouter un canal** : Base URL jusqu'à `/v1` (par exemple `https://api.deepseek.com/v1`), saisissez la clé d'API, puis listez les modèles servis par le canal.
2. Pour tester la bascule, **ajoutez un second canal** avec le même nom de modèle et un numéro de priorité plus grand (plus grand = secours).
3. Dans une conversation, cliquez sur le nom du modèle au-dessus de la zone de saisie → **Modèle** → choisissez-le dans le groupe `Channel relay`.

Avec un seul canal, le greffon ne change rien et ne bascule jamais : la bascule exige au moins deux canaux servant le même modèle logique.

Le journal de session enregistre toujours `provider: relay` ; il ne montre donc jamais quel canal a répondu. L'historique des bascules ne vit que dans le journal d'appels du greffon.

### Configurer un canal

![Formulaire d'ajout de canal](docs/setup-channel.png)

La Base URL va jusqu'à `/v1`. Le champ des modèles accepte `logique` ou `logique=amont` ; à l'enregistrement, les rattachements de ce canal sont remplacés et le résultat apparaît aussitôt dans le sélecteur.

### L'utiliser dans une conversation

![Le groupe Channel relay dans le sélecteur de modèles](docs/model-picker.png)

On le choisit et il se comporte comme n'importe quel modèle natif. Quand un modèle logique s'appuie sur plusieurs canaux, l'entrée porte un badge `×N` : c'est la taille du pool de bascule.

## Règles de bascule

| Signal amont | Code d'échec | Bascule | État du canal |
| --- | --- | --- | --- |
| 402 / 403 / 429 avec un texte de quota (`quota`, `balance`, `insufficient`) | `QUOTA` | oui | refroidi 30 minutes |
| 429 limite de débit (avec `Retry-After`) | `RATE_LIMIT` | oui | refroidi (selon l'en-tête, 45 s par défaut) |
| 401 / 403 clé invalide | `INVALID_CREDENTIAL` | oui | invalide 12 heures, sans retour automatique |
| 404 ou « modèle inexistant » | `MODEL_UNSUPPORTED` | oui | ce rattachement refroidit 5 minutes |
| 5xx | `SERVER` | oui | compté ; refroidit seulement après échecs répétés |
| Échec de connexion / expiration | `TRANSPORT` / `TIMEOUT` | oui | backoff exponentiel, plafond 10 min |
| 200 mais flux vide | `EMPTY_RESPONSE` | oui (une fois) | pas de refroidissement |
| 400 requête invalide, contexte trop long | `INVALID_REQUEST` / `CONTEXT_WINDOW_EXCEEDED` | non | pas de refroidissement |
| Annulé par l'utilisateur | `aborted` | non | pas de refroidissement |

Un canal refroidi ne disparaît pas des candidats : il passe en fin de liste. Si tous refroidissent, au moins un sera tenté.

Quand un modèle logique a plusieurs canaux, les capacités annoncées sont les **plus prudentes** : la fenêtre de contexte est la plus petite des canaux, faute de quoi un plan dimensionné pour le canal le plus large finirait par heurter un secours plus étroit.

## Répartition avec `dsh-llm-retry`

- **Ce greffon** : change de canal ; une requête parcourt la liste des canaux.
- **`dsh-llm-retry`** : réessaie les hoquets transitoires sur un même canal et relance une étape.

C'est pourquoi cette route renvoie `undefined` depuis `providerRetryPolicy()` : l'hôte ne doit pas rejouer une requête qui a déjà essayé tous les canaux.

## Données et confidentialité

| Quoi | Où |
| --- | --- |
| Canaux, rattachements, état de refroidissement, journal d'appels | `$DSH_HOME/storages/channel_relay/` |
| Clé d'API | `$DSH_HOME/.credentials.yaml`, enregistrement `dsh-channel-relay/<channel-id>` |

Supprimer un canal retire aussi ses rattachements, son état de refroidissement et sa clé. Le journal garde les 200 dernières entrées. Les messages d'erreur et les journaux sont expurgés : jamais de clé ni de corps de requête amont brut.

## Limites connues

- **Texte uniquement** : aucune capacité image n'est déclarée, les requêtes avec image suivent donc la voie dégradée de DSH.
- **Protocole compatible OpenAI seulement** (`/chat/completions`) : Anthropic Messages et OpenAI Responses ne sont pas implémentés.
- **Pas de partage entre processus** : l'état de refroidissement vit dans le processus ; deux instances DSH comptent séparément.
- **Les bascules sont invisibles dans le journal de session** : c'est voulu ; diagnostiquez avec le journal du greffon.
- Changer de canal fait perdre la signature de raisonnement et le cache de prompt de l'amont : coût assumé.

## Roadmap

- [ ] Limites RPM / TPM et plafond de concurrence par canal
- [ ] Budget souple local : couper selon l'argent ou les jetons
- [ ] Sondage actif du solde pour les canaux exposant `/balance`
- [ ] Protocoles Anthropic Messages / OpenAI Responses
- [ ] Étiquette « canal actuel » près de la zone de saisie
- [ ] Édition en ligne des rattachements

## Développement

```sh
node --check index.js    # Moitié Host
node --check client.js   # Moitié Client
```

- `index.js` — enregistrement du `LlmAdapter`, routage, traduction SSE → `StreamChunk`, machine à états des refroidissements, domaine de stockage et identifiants, 9 routes RPC
- `client.js` — icône de la barre latérale et panneau principal, dialogue avec l'hôte via `/api/dsh_multi_api/*`
- `DESIGN.md` — justification de conception et compromis (avec l'audit des capacités de DSH)

## License

[MIT](LICENSE)
