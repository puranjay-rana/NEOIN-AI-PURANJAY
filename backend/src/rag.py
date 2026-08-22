"""
RAG layer: indexes knowledge_base/ into a Chroma vector store and exposes a
simple retrieval function used by both the Question Agent (grounding
question generation in real material) and the Evaluation Agent (grounding
scoring in reference answers/rubrics).

Drop your own content into knowledge_base/: real past interview questions,
internal rubrics, engineering wiki pages, etc. Any .md/.txt files placed
there get picked up automatically.
"""
from __future__ import annotations

from typing import List, Optional

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma

from src.config import KB_DIR, PERSIST_DIR

_vectorstore: Optional[Chroma] = None


def _build_or_load_vectorstore() -> Chroma:
    global _vectorstore
    if _vectorstore is not None:
        return _vectorstore

    KB_DIR.mkdir(parents=True, exist_ok=True)
    embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

    if PERSIST_DIR.exists() and any(PERSIST_DIR.iterdir()):
        _vectorstore = Chroma(persist_directory=str(PERSIST_DIR), embedding_function=embeddings)
        return _vectorstore

    loader = DirectoryLoader(str(KB_DIR), glob="**/*.md", loader_cls=TextLoader)
    docs = loader.load()

    if not docs:
        # Empty KB is fine — retrieval just returns nothing until content is added.
        _vectorstore = Chroma(persist_directory=str(PERSIST_DIR), embedding_function=embeddings)
        return _vectorstore

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    chunks = splitter.split_documents(docs)

    _vectorstore = Chroma.from_documents(chunks, embeddings, persist_directory=str(PERSIST_DIR))
    return _vectorstore


def retrieve_context(query: str, k: int = 4) -> List[Document]:
    """Top-k most relevant chunks from the knowledge base for a given query."""
    vs = _build_or_load_vectorstore()
    return vs.similarity_search(query, k=k)


def format_docs(docs: List[Document]) -> str:
    if not docs:
        return "(no matching reference material found)"
    from pathlib import Path

    return "\n\n".join(
        f"[Source: {Path(d.metadata.get('source', 'kb')).name}]\n{d.page_content}" for d in docs
    )


def rebuild_index() -> None:
    """Force a full re-index (call after editing knowledge_base/ contents)."""
    global _vectorstore
    import shutil

    if PERSIST_DIR.exists():
        shutil.rmtree(PERSIST_DIR)
    _vectorstore = None
    _build_or_load_vectorstore()


if __name__ == "__main__":
    rebuild_index()
    print(f"Indexed knowledge base into {PERSIST_DIR}")
