

void printIndent(size_t indent);
void printString(const char *str);
void printJsonInner(JsonParser &jp, const JsonParserGeneratorRK::jsmntok_t *container, size_t indent) ;
void printJson(JsonParser &jp);

