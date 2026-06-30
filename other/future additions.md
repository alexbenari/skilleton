When working on LLM code:
- prompts should be implemented as md files, not placed in the code. 
- All LLM calls should use provider-native structured output when supported. Avoid result json parsing.
- Be explicit and ask for confirmationabout any non-default param passed to the model, such as limiting the number of tokens returned temperature etc. If the prompt explicitly requested that you change these params, you can skip confirmation.
- Model selection
  - Usage of Nebiius token factory ) as the default if LLm not specified. Suggest the most suitable LLM from the endpoints: https://tokenfactory.nebius.com/models
  - NEBIUS_API_KEY env var for api key

Internal scripts/utilities:
- run them to make sure they work before declaring they are done. E.g. if it is a tool to open the frontend make sure it opens correctly etc. If the utility/scripts generates data or perform potentially disrupting changes liker cleaanup etc ask before verifying.