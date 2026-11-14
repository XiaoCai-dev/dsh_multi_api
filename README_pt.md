![dsh_multi_api — relay multicanal de modelos para DSH](docs/banner.jpg)

# dsh_multi_api

[简体中文](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README.md) · [English](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_en.md) · [日本語](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_ja.md) · [Español](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_es.md) · [Français](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_fr.md) · [Deutsch](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_de.md) · [Русский](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_ru.md) · [Português](https://github.com/XiaoCai-dev/dsh_multi_api/blob/main/README_pt.md)

[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2%2B-4B32C3)](https://github.com/deepseek-ai) [![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org) [![JavaScript](https://img.shields.io/badge/JavaScript-ESM%20%C2%B7%20no%20build-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Web-lightgrey) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Relay multicanal de modelos para o [DeepSeek Harness](https://github.com/deepseek-ai): ligue um modelo lógico a vários endpoints compatíveis com OpenAI e troque em silêncio quando um canal fica sem cota, bate no limite de taxa, perde a chave ou falha na origem.**

O `dsh_multi_api` traz para dentro do processo do DSH a camada de «canais + mapeamento de modelos + failover» do new-api. Ele se registra como um `LlmAdapter` comum atrás de um provedor virtual, `relay`. Os modelos configurados aparecem no seletor de modelos da conversa e se comportam como os nativos.

- **Roteamento multicanal** — um modelo lógico pode se apoiar em quantos canais quiser; ordem por prioridade, peso dentro da mesma prioridade e próximo candidato em caso de falha.
- **Failover automático** — cota esgotada, credenciais inválidas, limites de taxa, `5xx`, timeouts ou «este endpoint não tem esse modelo» provocam a troca. Depois que sai conteúdo visível, não troca mais: duas respostas nunca são emendadas.
- **Resfriamentos que se recuperam** — 30 minutos por cota, 12 horas por chave inválida, `Retry-After` para limites de taxa, backoff exponencial para falhas repetidas; o estado sobrevive a reinícios e pode ser limpo à mão.
- **Gestão visual** — adicionar e editar canais, vincular modelos, testar conectividade, buscar a lista de modelos da origem e ver qual canal atendeu cada chamada e quantas trocas custou.
- **As chaves não vazam** — ficam na camada de credenciais do DSH, nunca em arquivos de configuração, logs ou mensagens de erro.

## Instalação / atualização

Requer DeepSeek Harness `0.2.0-rc.2` ou superior (desktop ou web).

### Pelo DeepSeek Harness

Barra lateral esquerda **Plugins → Add plugin**: escolha o diretório deste repositório ou cole a URL Git no campo de busca.

### Com a CLI `dsh`

```sh
dsh plugin --profile desktop add git+https://github.com/XiaoCai-dev/dsh_multi_api.git
```

De um diretório local (para desenvolvimento):

```sh
dsh plugin --profile desktop add /path/to/dsh_multi_api
```

Atualizar:

```sh
dsh plugin --profile desktop add git+https://github.com/XiaoCai-dev/dsh_multi_api.git
```

Desinstalar:

```sh
dsh plugin --profile desktop remove dsh_multi_api
```

Reinicie o DSH; **Channel relay** aparece na barra lateral esquerda.

## Uso

| Entrada | O que faz |
| --- | --- |
| **Canais** | Adicionar, editar e excluir canais: Base URL, chave de API, prioridade, peso, timeout e os modelos que o canal serve (`lógico` ou `lógico=origem`). Ações na linha: testar conectividade, buscar modelos da origem, limpar resfriamento. |
| **Rotas de modelos** | Um cartão por modelo lógico, com a cadeia de failover (canal A → canal B) e o id real do modelo em cada canal; os vínculos são adicionados e removidos aqui. |
| **Chamadas e failover** | As últimas 200 chamadas: resultado (sucesso / com troca / todos os canais falharam), modelo, duração total e cadeia de canais; expanda a linha para ver o código de erro e o tempo de cada tentativa. |
| **Seletor de modelos** | Os modelos lógicos configurados aparecem no grupo `Channel relay`; escolha um e use. Modelos com vários canais trazem um selo `×N`. |

### Início rápido

1. **Canais → Adicionar canal**: coloque a Base URL até `/v1` (por exemplo `https://api.deepseek.com/v1`), informe a chave de API e liste os modelos que o canal serve.
2. Para testar o failover, **adicione um segundo canal** com o mesmo nome de modelo e um número de prioridade maior (número maior = reserva).
3. Na conversa, clique no nome do modelo acima da caixa de texto → **Modelo** → escolha-o no grupo `Channel relay`.

Com um único canal o plugin não muda nada e nunca troca — o failover exige pelo menos dois canais servindo o mesmo modelo lógico.

O log da sessão registra sempre `provider: relay`, então nunca mostra qual canal respondeu; as trocas vivem apenas no log de chamadas do plugin.

### Configurar um canal

![Formulário de novo canal](docs/setup-channel.png)

A Base URL vai até `/v1`. O campo de modelos aceita `lógico` ou `lógico=origem`; ao salvar, os vínculos desse canal são substituídos e o resultado aparece na hora no seletor de modelos.

### Usar numa conversa

![O grupo Channel relay no seletor de modelos](docs/model-picker.png)

Escolhe e funciona como qualquer modelo nativo. Quando um modelo lógico se apoia em vários canais, a entrada traz um selo `×N` — esse é o tamanho do pool de failover.

## Regras de failover

| Sinal da origem | Código de falha | Troca? | Estado do canal |
| --- | --- | --- | --- |
| 402 / 403 / 429 com texto de cota (`quota`, `balance`, `insufficient`) | `QUOTA` | sim | resfriado por 30 minutos |
| 429 limite de taxa (com `Retry-After`) | `RATE_LIMIT` | sim | resfriado (conforme cabeçalho, 45 s por padrão) |
| 401 / 403 chave inválida | `INVALID_CREDENTIAL` | sim | inválido por 12 horas, sem recuperação automática |
| 404 ou «o modelo não existe» | `MODEL_UNSUPPORTED` | sim | aquele vínculo resfria por 5 minutos |
| 5xx | `SERVER` | sim | contabilizado; resfria só após falhas repetidas |
| Falha de conexão / timeout | `TRANSPORT` / `TIMEOUT` | sim | backoff exponencial, teto de 10 min |
| 200 com fluxo vazio | `EMPTY_RESPONSE` | sim (uma vez) | sem resfriamento |
| 400 requisição inválida, contexto longo demais | `INVALID_REQUEST` / `CONTEXT_WINDOW_EXCEEDED` | não | sem resfriamento |
| Cancelado pelo usuário | `aborted` | não | sem resfriamento |

Um canal resfriado não sai da lista de candidatos: apenas vai para o fim. Se todos estiverem resfriados, ao menos um será tentado.

Quando um modelo lógico tem vários canais, as capacidades anunciadas são as **mais conservadoras**: a janela de contexto é a menor entre os canais, senão um plano dimensionado para o canal mais amplo acabaria batendo num reserva mais estreito.

## Divisão com o `dsh-llm-retry`

- **Este plugin**: troca de canal — uma requisição percorre a lista de canais.
- **`dsh-llm-retry`**: repete oscilações passageiras no mesmo canal e reexecuta um step.

Por isso esta rota devolve `undefined` em `providerRetryPolicy()`: o host não deve repetir uma requisição que já tentou todos os canais.

## Dados e privacidade

| O quê | Onde |
| --- | --- |
| Canais, vínculos de modelos, estado de resfriamento, log de chamadas | `$DSH_HOME/storages/channel_relay/` |
| Chave de API | `$DSH_HOME/.credentials.yaml`, registro `dsh-channel-relay/<channel-id>` |

Excluir um canal remove também seus vínculos, o estado de resfriamento e a chave. O log guarda as últimas 200 entradas. Mensagens de erro e logs passam por limpeza: chaves e o corpo bruto da requisição à origem nunca aparecem.

## Limitações conhecidas

- **Só texto**: nenhuma capacidade de imagem é declarada, então requisições com imagem seguem o caminho degradado do DSH.
- **Somente protocolo compatível com OpenAI** (`/chat/completions`): Anthropic Messages e OpenAI Responses não estão implementados.
- **Sem estado entre processos**: o resfriamento vive no processo; duas instâncias do DSH contam separadamente.
- **Trocas de canal são invisíveis no log da sessão**: é intencional; diagnostique pelo log do plugin.
- Trocar de canal perde a assinatura de reasoning e o cache de prompt da origem — custo aceito.

## Roadmap

- [ ] Limites de RPM / TPM e teto de concorrência por canal
- [ ] Orçamento flexível local: cortar por dinheiro ou por tokens
- [ ] Sondagem ativa de saldo para canais que expõem `/balance`
- [ ] Protocolos Anthropic Messages / OpenAI Responses
- [ ] Rótulo de «canal atual» junto à caixa de texto
- [ ] Edição de vínculos na própria linha

## Desenvolvimento

```sh
node --check index.js    # Metade Host
node --check client.js   # Metade Client
```

- `index.js` — registro do `LlmAdapter`, roteamento, tradução SSE → `StreamChunk`, máquina de estados de resfriamento, domínio de armazenamento e credenciais, 9 rotas RPC
- `client.js` — ícone da barra lateral e painel principal, conversando com o host via `/api/dsh_multi_api/*`
- `DESIGN.md` — justificativa de projeto e trade-offs (inclui a auditoria de capacidades do DSH)

## License

[MIT](LICENSE)
