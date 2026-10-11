# Gerador de XML VRSync

Formulário web que gera o feed XML no padrão **VRSync**, usado pelo Grupo OLX (ZAP Imóveis, VivaReal e Canal Pro).

Documentação de referência: https://developers.grupozap.com/feeds/vrsync/

## Como usar

Abra o `index.html` no navegador. Não há build nem dependências.

1. Preencha o cabeçalho (`Header`) e os dados da imobiliária (`ContactInfo`).
2. Cadastre um ou mais imóveis.
3. Clique em **Validar e gerar XML**, depois copie o resultado ou baixe o arquivo `.xml`.

Os dados ficam salvos no `localStorage` do navegador. Para levar o projeto para outro computador, use **Exportar** e **Importar projeto (.json)**.

## Estrutura

| Arquivo | Conteúdo |
| --- | --- |
| `js/spec.js` | Todos os valores aceitos e regras da documentação: tipos de transação, de publicação e de imóvel, Features, Warranties, períodos, UFs e limites |
| `js/xml.js` | Geração do XML na ordem dos exemplos oficiais, com CDATA e encoding UTF-8 ou ISO8859-1 |
| `js/validate.js` | Regras da documentação, divididas em erros (o portal recusa) e avisos (recomendações) |
| `js/app.js` | Formulário: ligação dos campos, mídia, features, persistência e download |

## Decisões tomadas onde a documentação é ambígua

- **YearlyTax**: está em desuso e foi substituído por `Iptu`. Só é enviado se o usuário marcar a opção correspondente.
- **Commercial / Loja** e **Commercial / Studio**: aparecem apenas nas tabelas de obrigatoriedade de banheiros e quartos, e não na tabela de `PropertyType`. Ficam disponíveis no formulário, mas geram um aviso.
- **Features fora da tabela**: os exemplos completos usam valores que não estão na tabela oficial, como `Close to schools` e `Veranda`. Eles ficam num grupo separado. Também é possível digitar um valor livre.
- **LivingArea em terrenos**: a documentação pede `LotArea` para terrenos, galpões e fazendas, mas também diz que `LivingArea` "requer ao menos um valor". Nesses tipos, a falta de `LotArea` é tratada como erro e a falta de `LivingArea` como aviso.
- **Garage `type="Parking Space"`**: aparece nos exemplos completos, mas não na seção de `Garage`. O atributo é opcional e vem ligado por padrão.
- **Warranties**: só são enviadas quando a transação inclui aluguel.
