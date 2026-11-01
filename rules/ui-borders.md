# Padrão de Arredondamento e Cantos (Border Radius)

Ao criar ou refatorar qualquer componente de interface (especialmente modais, formulários, botões e caixas interativas), siga rigorosamente a seguinte escala de arredondamento mais sóbria e reta:

### 1. Escala de Arredondamento
- **Containers e Modais:** `6px` (no Tailwind: `rounded-md`, ou CSS: `border-radius: 6px;`) — *anteriormente 16px*.
- **Campos, Selects e Botões:** `4px` (no Tailwind: `rounded`, ou CSS: `border-radius: 4px;`) — *anteriormente 10px*.
- *(Variação ainda mais reta quando requisitado especificamente: `4px` em modais com `rounded` e `2px` em campos com `rounded-sm`).*

### 2. Proibições
- **NÃO** utilizar cantos excessivamente arredondados como `rounded-xl` (12px), `rounded-2xl` (16px) ou formato pílula (`rounded-full`) em caixas estruturais, botões de ação ou modais.
- O visual deve permanecer técnico, sóbrio, limpo e retangular com cantos sutilmente suavizados.

### 3. Profundidade e Sombras
- A **sombra em camadas** deve ser sempre mantida para que o modal preserve sua profundidade, contraste e separação visual mesmo com cantos mais retos.

### 4. Equivalências
- **Modal:** `.modal { border-radius: 6px; }` → Tailwind `rounded-md`
- **Campos e Botões:** `.modal input, .modal select, .modal button { border-radius: 4px; }` → Tailwind `rounded`
