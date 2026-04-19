import sys
import spacy
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

nlp = spacy.load("en_core_web_md")  # IMPORTANT: use 'md' or 'lg', not 'sm' — needs word vectors

# Bloom's verbs mapped to levels
blooms_verbs_by_level = {
    "remember":  ["recall", "define", "identify", "describe", "list", "name", "state",
                  "memorize", "recognize", "label", "locate", "quote", "enumerate"],
    "understand": ["explain", "interpret", "summarize", "classify", "compare", "discuss",
                   "distinguish", "predict", "contrast", "demonstrate", "infer", "translate",
                   "generalize", "illustrate", "paraphrase"],
    "apply":     ["solve", "apply", "use", "calculate", "demonstrate", "experiment",
                  "practice", "simulate", "modify", "complete", "relate", "transfer"],
    "analyze":   ["analyze", "analyse", "compare", "differentiate", "categorize", "deduce",
                  "dissect", "separate", "correlate", "devise", "contrast", "infer"],
    "evaluate":  ["evaluate", "judge", "assess", "critique", "justify", "argue", "defend",
                  "recommend", "conclude", "debate", "discriminate", "appraise", "rank", "weigh"],
    "create":    ["design", "compose", "plan", "formulate", "invent", "construct", "develop",
                  "produce", "hypothesize", "integrate", "assemble", "originate", "propose"]
}

# Flatten: verb → level
verb_to_level = {
    verb: level
    for level, verbs in blooms_verbs_by_level.items()
    for verb in verbs
}

all_known_verbs = list(verb_to_level.keys())

# Pre-compute vectors for all known Bloom's verbs (done once at load time)
known_verb_vectors = {}
for verb in all_known_verbs:
    token = nlp(verb)
    if token.has_vector:
        known_verb_vectors[verb] = token.vector

SIMILARITY_THRESHOLD = 0.6  # Minimum similarity to accept a mapping

def find_closest_blooms_verb(unknown_verb, threshold=SIMILARITY_THRESHOLD):
    """
    Given an unknown verb, find the closest Bloom's verb using cosine similarity.
    Returns (closest_verb, level, similarity_score) or None if below threshold.
    """
    unknown_token = nlp(unknown_verb)
    if not unknown_token.has_vector:
        return None  # Can't compare if no vector exists

    unknown_vec = unknown_token.vector.reshape(1, -1)

    best_match = None
    best_score = -1

    for known_verb, known_vec in known_verb_vectors.items():
        score = cosine_similarity(unknown_vec, known_vec.reshape(1, -1))[0][0]
        if score > best_score:
            best_score = score
            best_match = known_verb

    if best_score >= threshold:
        mapped_level = verb_to_level[best_match]
        return {
            "matched_to": best_match,
            "level": mapped_level,
            "score": round(float(best_score), 4)
        }

    return None  # Below threshold — truly unknown


def extract_blooms_verbs(text):
    doc = nlp(text)

    direct_matches = []   # verbs found directly in Bloom's dictionary
    inferred_matches = [] # verbs mapped via cosine similarity

    seen_lemmas = set()

    for token in doc:
        if token.pos_ != "VERB":
            continue

        lemma = token.lemma_.lower().strip()
        if not lemma.isalpha() or lemma in seen_lemmas:
            continue
        seen_lemmas.add(lemma)

        if lemma in verb_to_level:
            # Direct match
            direct_matches.append({
                "verb": lemma,
                "level": verb_to_level[lemma],
                "match_type": "direct"
            })
        else:
            # Try cosine similarity fallback
            result = find_closest_blooms_verb(lemma)
            if result:
                inferred_matches.append({
                    "verb": lemma,
                    "level": result["level"],
                    "matched_to": result["matched_to"],
                    "score": result["score"],
                    "match_type": "inferred"
                })

    return direct_matches, inferred_matches


if __name__ == "__main__":
    import json
    input_text = sys.stdin.read().strip()
    if not input_text:
        print(json.dumps([]))
        sys.exit(0)

    try:
        questions = json.loads(input_text)
    except json.JSONDecodeError:
        print("Invalid JSON input.", file=sys.stderr)
        sys.exit(1)
        
    results = []
    for q in questions:
        if not isinstance(q, str) or not q.strip():
            results.append({"direct": [], "inferred": []})
            continue
            
        direct, inferred = extract_blooms_verbs(q)
        results.append({
            "direct": direct,
            "inferred": inferred
        })

    print(json.dumps(results))