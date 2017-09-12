document.body.addEventListener("keyup", keypress);
const SPECIAL_CHARS_REGEX = /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g

const bitapRegexSearch = (text, pattern, tokenSeparator = / +/g) => {
  let regex = new RegExp(pattern.replace(SPECIAL_CHARS_REGEX, '\\$&').replace(tokenSeparator, '|'));
  let matches = text.match(regex);
  let isMatch = !!matches;
  let matchedIndices = [];

  if (isMatch) {
    for (let i = 0, matchesLen = matches.length; i < matchesLen; i += 1) {
      let match = matches[i];
      matchedIndices.push([text.indexOf(match), match.length - 1]);
    }
  }

  return {
    // TODO: revisit this score
    score: isMatch ? 0.5 : 1,
    isMatch,
    matchedIndices
  };
};

const bitapScore = (pattern, { errors = 0, currentLocation = 0, expectedLocation = 0, distance = 100 }) => {
  const accuracy = errors / pattern.length;
  const proximity = Math.abs(expectedLocation - currentLocation);

  if (!distance) {
    // Dodge divide by zero error.
    return proximity ? 1.0 : accuracy;
  }

  return accuracy + (proximity / distance);
};
const matchedIndices = (matchmask = [], minMatchCharLength = 1) => {
  let matchedIndices = []
  let start = -1
  let end = -1
  let i = 0

  for (let len = matchmask.length; i < len; i += 1) {
    let match = matchmask[i]
    if (match && start === -1) {
      start = i
    } else if (!match && start !== -1) {
      end = i - 1
      if ((end - start) + 1 >= minMatchCharLength) {
        matchedIndices.push([start, end])
      }
      start = -1
    }
  }

  // (i-1 - start) + 1 => i - start
  if (matchmask[i - 1] && (i - start) >= minMatchCharLength) {
    matchedIndices.push([start, i - 1])
  }

  return matchedIndices
};

const bitapSearch = (text, pattern, patternAlphabet, { location = 0, distance = 100, threshold = 0.6, findAllMatches = false, minMatchCharLength = 1 }) => {
  const expectedLocation = location
  // Set starting location at beginning text and initialize the alphabet.
  const textLen = text.length
  // Highest score beyond which we give up.
  let currentThreshold = threshold
  // Is there a nearby exact match? (speedup)
  let bestLocation = text.indexOf(pattern, expectedLocation)

  const patternLen = pattern.length

  // a mask of the matches
  const matchMask = []
  for (let i = 0; i < textLen; i += 1) {
    matchMask[i] = 0
  }

  if (bestLocation !== -1) {
    let score = bitapScore(pattern, {
      errors: 0,
      currentLocation: bestLocation,
      expectedLocation,
      distance
    })
    currentThreshold = Math.min(score, currentThreshold)

    // What about in the other direction? (speed up)
    bestLocation = text.lastIndexOf(pattern, expectedLocation + patternLen)

    if (bestLocation !== -1) {
      let score = bitapScore(pattern, {
        errors: 0,
        currentLocation: bestLocation,
        expectedLocation,
        distance
      })
      currentThreshold = Math.min(score, currentThreshold)
    }
  }

  // Reset the best location
  bestLocation = -1

  let lastBitArr = []
  let finalScore = 1
  let binMax = patternLen + textLen

  const mask = 1 << (patternLen - 1)

  for (let i = 0; i < patternLen; i += 1) {
    // Scan for the best match; each iteration allows for one more error.
    // Run a binary search to determine how far from the match location we can stray
    // at this error level.
    let binMin = 0
    let binMid = binMax

    while (binMin < binMid) {
      const score = bitapScore(pattern, {
        errors: i,
        currentLocation: expectedLocation + binMid,
        expectedLocation,
        distance
      })

      if (score <= currentThreshold) {
        binMin = binMid
      } else {
        binMax = binMid
      }

      binMid = Math.floor((binMax - binMin) / 2 + binMin)
    }

    // Use the result from this iteration as the maximum for the next.
    binMax = binMid

    let start = Math.max(1, expectedLocation - binMid + 1)
    let finish = findAllMatches ? textLen : Math.min(expectedLocation + binMid, textLen) + patternLen

    // Initialize the bit array
    let bitArr = Array(finish + 2)

    bitArr[finish + 1] = (1 << i) - 1

    for (let j = finish; j >= start; j -= 1) {
      let currentLocation = j - 1
      let charMatch = patternAlphabet[text.charAt(currentLocation)]

      if (charMatch) {
        matchMask[currentLocation] = 1
      }

      // First pass: exact match
      bitArr[j] = ((bitArr[j + 1] << 1) | 1) & charMatch

      // Subsequent passes: fuzzy match
      if (i !== 0) {
        bitArr[j] |= (((lastBitArr[j + 1] | lastBitArr[j]) << 1) | 1) | lastBitArr[j + 1]
      }

      if (bitArr[j] & mask) {
        finalScore = bitapScore(pattern, {
          errors: i,
          currentLocation,
          expectedLocation,
          distance
        })

        // This match will almost certainly be better than any existing match.
        // But check anyway.
        if (finalScore <= currentThreshold) {
          // Indeed it is
          currentThreshold = finalScore
          bestLocation = currentLocation

          // Already passed `loc`, downhill from here on in.
          if (bestLocation <= expectedLocation) {
            break
          }

          // When passing `bestLocation`, don't exceed our current distance from `expectedLocation`.
          start = Math.max(1, 2 * expectedLocation - bestLocation)
        }
      }
    }

    // No hope for a (better) match at greater error levels.
    const score = bitapScore(pattern, {
      errors: i + 1,
      currentLocation: expectedLocation,
      expectedLocation,
      distance
    })

    if (score > currentThreshold) {
      break
    }

    lastBitArr = bitArr
  }

  // Count exact matches (those with a score of 0) to be "almost" exact
  return {
    isMatch: bestLocation >= 0,
    score: finalScore === 0 ? 0.001 : finalScore,
    matchedIndices: matchedIndices(matchMask, minMatchCharLength)
  }
}
const patternAlphabet = (pattern) => {
  let mask = {}
  let len = pattern.length

  for (let i = 0; i < len; i += 1) {
    mask[pattern.charAt(i)] = 0
  }

  for (let i = 0; i < len; i += 1) {
    mask[pattern.charAt(i)] |= 1 << (len - i - 1)
  }

  return mask
};
class Bitap {
  constructor (pattern, { 
    // Approximately where in the text is the pattern expected to be found?
    location = 0, 
    // Determines how close the match must be to the fuzzy location (specified above).
    // An exact letter match which is 'distance' characters away from the fuzzy location
    // would score as a complete mismatch. A distance of '0' requires the match be at
    // the exact location specified, a threshold of '1000' would require a perfect match
    // to be within 800 characters of the fuzzy location to be found using a 0.8 threshold.
    distance = 100, 
    // At what point does the match algorithm give up. A threshold of '0.0' requires a perfect match
    // (of both letters and location), a threshold of '1.0' would match anything.
    threshold = 0.6, 
    // Machine word size
    maxPatternLength = 32,
    // Indicates whether comparisons should be case sensitive.
    isCaseSensitive = false,
    // Regex used to separate words when searching. Only applicable when `tokenize` is `true`.
    tokenSeparator = / +/g,
    // When true, the algorithm continues searching to the end of the input even if a perfect
    // match is found before the end of the same input.
    findAllMatches = false,
    // Minimum number of characters that must be matched before a result is considered a match
    minMatchCharLength = 1
  }) {
    this.options = {
      location,
      distance,
      threshold,
      maxPatternLength,
      isCaseSensitive,
      tokenSeparator,
      findAllMatches,
      minMatchCharLength
    }

    this.pattern = this.options.isCaseSensitive ? pattern : pattern.toLowerCase()

    if (this.pattern.length <= maxPatternLength) {
      this.patternAlphabet = patternAlphabet(this.pattern)
    }
  }

  search (text) {
    if (!this.options.isCaseSensitive) {
      text = text.toLowerCase()
    }

    // Exact match
    if (this.pattern === text) {
      return {
        isMatch: true,
        score: 0,
        matchedIndices: [[0, text.length - 1]]
      }
    }

    // When pattern length is greater than the machine word length, just do a a regex comparison
    const { maxPatternLength, tokenSeparator } = this.options
    if (this.pattern.length > maxPatternLength) {
      return bitapRegexSearch(text, this.pattern, tokenSeparator)
    }

    // Otherwise, use Bitap algorithm
    const { location, distance, threshold, findAllMatches, minMatchCharLength } = this.options
    return bitapSearch(text, this.pattern, this.patternAlphabet, {
      location,
      distance,
      threshold,
      findAllMatches,
      minMatchCharLength
    })
  }
};

// let x = new Bitap("od mn war", {})
// let result = x.search("Old Man's War")
// console.log(result)


const isArray = obj => Object.prototype.toString.call(obj) === '[object Array]';

function deepValue(obj, path, list){
  if (!path) {
    // If there's no path left, we've gotten to the object we care about.
    list.push(obj)
  } else {
    const dotIndex = path.indexOf('.')
    let firstSegment = path
    let remaining = null

    if (dotIndex !== -1) {
      firstSegment = path.slice(0, dotIndex)
      remaining = path.slice(dotIndex + 1)
    }

    const value = obj[firstSegment]
        
    if (value !== null && value !== undefined) {
      if (!remaining && (typeof value === 'string' || typeof value === 'number')) {
        list.push(value.toString())
      } else if (isArray(value)) {
        // Search each item in the array.
        for (let i = 0, len = value.length; i < len; i += 1) {
          deepValue(value[i], remaining, list)
        }   
      } else if (remaining) {
        // An object. Recurse further.
        deepValue(value, remaining, list)
      }   
    }   
  }
  return list
}




class Fuse {
  constructor (list, {
    // Approximately where in the text is the pattern expected to be found?
    location = 0,
    // Determines how close the match must be to the fuzzy location (specified above).
    // An exact letter match which is 'distance' characters away from the fuzzy location
    // would score as a complete mismatch. A distance of '0' requires the match be at
    // the exact location specified, a threshold of '1000' would require a perfect match
    // to be within 800 characters of the fuzzy location to be found using a 0.8 threshold.
    distance = 100,
    // At what point does the match algorithm give up. A threshold of '0.0' requires a perfect match
    // (of both letters and location), a threshold of '1.0' would match anything.
    threshold = 0.6,
    // Machine word size
    maxPatternLength = 32,
    // Indicates whether comparisons should be case sensitive.
    caseSensitive = false,
    // Regex used to separate words when searching. Only applicable when `tokenize` is `true`.
    tokenSeparator = / +/g,
    // When true, the algorithm continues searching to the end of the input even if a perfect
    // match is found before the end of the same input.
    findAllMatches = false,
    // Minimum number of characters that must be matched before a result is considered a match
    minMatchCharLength = 1,
    // The name of the identifier property. If specified, the returned result will be a list
    // of the items' dentifiers, otherwise it will be a list of the items.
    id = null,
    // List of properties that will be searched. This also supports nested properties.
    keys = [],
    // Whether to sort the result list, by score
    shouldSort = true,
    // The get function to use when fetching an object's properties.
    // The default will search nested paths *ie foo.bar.baz*
    getFn = deepValue,
    // Default sort function
    sortFn = (a, b) => (a.score - b.score),
    // When true, the search algorithm will search individual words **and** the full string,
    // computing the final score as a function of both. Note that when `tokenize` is `true`,
    // the `threshold`, `distance`, and `location` are inconsequential for individual tokens.
    tokenize = false,
    // When true, the result set will only include records that match all tokens. Will only work
    // if `tokenize` is also true.
    matchAllTokens = false,

    includeMatches = false,
    includeScore = false,

    // Will print to the console. Useful for debugging.
    verbose = false
  }) {
    this.options = {
      location,
      distance,
      threshold,
      maxPatternLength,
      isCaseSensitive: caseSensitive,
      tokenSeparator,
      findAllMatches,
      minMatchCharLength,
      id,
      keys,
      includeMatches,
      includeScore,
      shouldSort,
      getFn,
      sortFn,
      verbose,
      tokenize,
      matchAllTokens
    };

    this.setCollection(list);
  }

  setCollection (list) {
    this.list = list
    return list
  }

  search (pattern) {
    this._log(`---------\nSearch pattern: "${pattern}"`);

    const {
      tokenSearchers,
      fullSearcher
    } = this._prepareSearchers(pattern);

    let { weights, results } = this._search(tokenSearchers, fullSearcher);

    this._computeScore(weights, results);

    if (this.options.shouldSort) {
      this._sort(results);
    }
    return this._format(results);
  }

  _prepareSearchers (pattern = '') {
    const tokenSearchers = []

    if (this.options.tokenize) {
      // Tokenize on the separator
      const tokens = pattern.split(this.options.tokenSeparator)
      for (let i = 0, len = tokens.length; i < len; i += 1) {
        tokenSearchers.push(new Bitap(tokens[i], this.options))
      }
    }

    let fullSearcher = new Bitap(pattern, this.options)

    return { tokenSearchers, fullSearcher }
  }

  _search (tokenSearchers = [], fullSearcher) {
    const list = this.list
    const resultMap = {}
    const results = []

    // Check the first item in the list, if it's a string, then we assume
    // that every item in the list is also a string, and thus it's a flattened array.
    if (typeof list[0] === 'string') {
      // Iterate over every item
      for (let i = 0, len = list.length; i < len; i += 1) {
        this._analyze({
          key: '',
          value: list[i],
          record: i,
          index: i
        }, {
          resultMap,
          results,
          tokenSearchers,
          fullSearcher
        })
      }

      return { weights: null, results }
    }

    // Otherwise, the first item is an Object (hopefully), and thus the searching
    // is done on the values of the keys of each item.
    const weights = {}
    for (let i = 0, len = list.length; i < len; i += 1) {
      let item = list[i]
      // Iterate over every key
      for (let j = 0, keysLen = this.options.keys.length; j < keysLen; j += 1) {
        let key = this.options.keys[j]
        if (typeof key !== 'string') {
          weights[key.name] = {
            weight: (1 - key.weight) || 1
          }
          if (key.weight <= 0 || key.weight > 1) {
            throw new Error('Key weight has to be > 0 and <= 1')
          }
          key = key.name
        } else {
          weights[key] = {
            weight: 1
          }
        }

        this._analyze({
          key,
          value: this.options.getFn(item, key,[]),
          record: item,
          index: i
        }, {
          resultMap,
          results,
          tokenSearchers,
          fullSearcher
        })
      }
    }

    return { weights, results }
  }

  _analyze ({ key, arrayIndex = -1, value, record, index }, { tokenSearchers = [], fullSearcher = [], resultMap = {}, results = [] }) {
    // Check if the texvaluet can be searched
    if (value === undefined || value === null) {
      return
    }

    let exists = false
    let averageScore = -1
    let numTextMatches = 0

    if (typeof value === 'string') {
      this._log(`\nKey: ${key === '' ? '-' : key}`)

      let mainSearchResult = fullSearcher.search(value)
      this._log(`Full text: "${value}", score: ${mainSearchResult.score}`)

      if (this.options.tokenize) {
        let words = value.split(this.options.tokenSeparator)
        let scores = []

        for (let i = 0; i < tokenSearchers.length; i += 1) {
          let tokenSearcher = tokenSearchers[i]

          this._log(`\nPattern: "${tokenSearcher.pattern}"`)

          // let tokenScores = []
          let hasMatchInText = false

          for (let j = 0; j < words.length; j += 1) {
            let word = words[j]
            let tokenSearchResult = tokenSearcher.search(word)
            let obj = {}
            if (tokenSearchResult.isMatch) {
              obj[word] = tokenSearchResult.score
              exists = true
              hasMatchInText = true
              scores.push(tokenSearchResult.score)
            } else {
              obj[word] = 1
              if (!this.options.matchAllTokens) {
                scores.push(1)
              }
            }
            this._log(`Token: "${word}", score: ${obj[word]}`)
            // tokenScores.push(obj)
          }

          if (hasMatchInText) {
            numTextMatches += 1
          }
        }

        averageScore = scores[0]
        let scoresLen = scores.length
        for (let i = 1; i < scoresLen; i += 1) {
          averageScore += scores[i]
        }
        averageScore = averageScore / scoresLen

        this._log('Token score average:', averageScore)
      }

      let finalScore = mainSearchResult.score
      if (averageScore > -1) {
        finalScore = (finalScore + averageScore) / 2
      }

      this._log('Score average:', finalScore)

      let checkTextMatches = (this.options.tokenize && this.options.matchAllTokens) ? numTextMatches >= tokenSearchers.length : true

      this._log(`\nCheck Matches: ${checkTextMatches}`)

      // If a match is found, add the item to <rawResults>, including its score
      if ((exists || mainSearchResult.isMatch) && checkTextMatches) {
        // Check if the item already exists in our results
        let existingResult = resultMap[index]
        if (existingResult) {
          // Use the lowest score
          // existingResult.score, bitapResult.score
          existingResult.output.push({
            key,
            arrayIndex,
            value,
            score: finalScore,
            matchedIndices: mainSearchResult.matchedIndices
          })
        } else {
          // Add it to the raw result list
          resultMap[index] = {
            item: record,
            output: [{
              key,
              arrayIndex,
              value,
              score: finalScore,
              matchedIndices: mainSearchResult.matchedIndices
            }]
          }

          results.push(resultMap[index])
        }
      }
    } else if (isArray(value)) {
      for (let i = 0, len = value.length; i < len; i += 1) {
        this._analyze({
          key,
          arrayIndex: i,
          value: value[i],
          record,
          index
        }, {
          resultMap,
          results,
          tokenSearchers,
          fullSearcher
        })
      }
    }
  }

  _computeScore (weights, results) {
    this._log('\n\nComputing score:\n')

    for (let i = 0, len = results.length; i < len; i += 1) {
      const output = results[i].output
      const scoreLen = output.length

      let totalScore = 0
      let bestScore = 1

      for (let j = 0; j < scoreLen; j += 1) {
        let score = output[j].score
        let weight = weights ? weights[output[j].key].weight : 1
        let nScore = score * weight

        if (weight !== 1) {
          bestScore = Math.min(bestScore, nScore)
        } else {
          output[j].nScore = nScore
          totalScore += nScore
        }
      }

      results[i].score = bestScore === 1 ? totalScore / scoreLen : bestScore

      this._log(results[i])
    }
  }

  _sort (results) {
    this._log('\n\nSorting....')
    results.sort(this.options.sortFn)
  }

  _format (results) {
    const finalOutput = []

    this._log('\n\nOutput:\n\n', JSON.stringify(results))

    let transformers = []

    if (this.options.includeMatches) {
      transformers.push((result, data) => {
        const output = result.output
        data.matches = []

        for (let i = 0, len = output.length; i < len; i += 1) {
          let item = output[i]

          if (item.matchedIndices.length === 0) {
            continue
          }

          let obj = {
            indices: item.matchedIndices,
            value: item.value
          }
          if (item.key) {
            obj.key = item.key
          }
          if (item.hasOwnProperty('arrayIndex') && item.arrayIndex > -1) {
            obj.arrayIndex = item.arrayIndex
          }
          data.matches.push(obj)
        }
      })
    }

    if (this.options.includeScore) {
      transformers.push((result, data) => {
        data.score = result.score
      })
    }

    for (let i = 0, len = results.length; i < len; i += 1) {
      const result = results[i]

      if (this.options.id) {
        result.item = this.options.getFn(result.item, this.options.id)[0]
      }

      if (!transformers.length) {
        finalOutput.push(result.item)
        continue
      }

      const data = {
        item: result.item
      }

      for (let j = 0, len = transformers.length; j < len; j += 1) {
        transformers[j](result, data)
      }

      finalOutput.push(data)
    }

    return finalOutput
  }

  _log () {
    if (this.options.verbose) {
      console.log(...arguments)
    }
  }
}


var options = {
  shouldSort: true,
  threshold: 0.3,
  location: 0,
  distance: 100,
  maxPatternLength: 16,
  minMatchCharLength: 1,
  findAllMatches: true,
  keys: [
    "word"
    ]
};


var words = [{"word": "you"}, {"word": "I"}, {"word": "to"}, {"word": "the"}, {"word": "a"}, {"word": "and"}, {"word": "that"}, {"word": "it"}, {"word": "of"}, {"word": "me"}, {"word": "what"}, {"word": "is"}, {"word": "in"}, {"word": "this"}, {"word": "know"}, {"word": "I'm"}, {"word": "for"}, {"word": "no"}, {"word": "have"}, {"word": "my"}, {"word": "don't"}, {"word": "just"}, {"word": "not"}, {"word": "do"}, {"word": "be"}, {"word": "on"}, {"word": "your"}, {"word": "was"}, {"word": "we"}, {"word": "it's"}, {"word": "with"}, {"word": "so"}, {"word": "but"}, {"word": "all"}, {"word": "well"}, {"word": "are"}, {"word": "he"}, {"word": "oh"}, {"word": "about"}, {"word": "right"}, {"word": "you're"}, {"word": "get"}, {"word": "here"}, {"word": "out"}, {"word": "going"}, {"word": "like"}, {"word": "yeah"}, {"word": "if"}, {"word": "her"}, {"word": "she"}, {"word": "can"}, {"word": "up"}, {"word": "want"}, {"word": "think"}, {"word": "that's"}, {"word": "now"}, {"word": "go"}, {"word": "him"}, {"word": "at"}, {"word": "how"}, {"word": "got"}, {"word": "there"}, {"word": "one"}, {"word": "did"}, {"word": "why"}, {"word": "see"}, {"word": "come"}, {"word": "good"}, {"word": "they"}, {"word": "really"}, {"word": "as"}, {"word": "would"}, {"word": "look"}, {"word": "when"}, {"word": "time"}, {"word": "will"}, {"word": "okay"}, {"word": "back"}, {"word": "can't"}, {"word": "mean"}, {"word": "tell"}, {"word": "I'll"}, {"word": "from"}, {"word": "hey"}, {"word": "were"}, {"word": "he's"}, {"word": "could"}, {"word": "didn't"}, {"word": "yes"}, {"word": "his"}, {"word": "been"}, {"word": "or"}, {"word": "something"}, {"word": "who"}, {"word": "because"}, {"word": "some"}, {"word": "had"}, {"word": "then"}, {"word": "say"}, {"word": "ok"}, {"word": "take"}, {"word": "an"}, {"word": "way"}, {"word": "us"}, {"word": "little"}, {"word": "make"}, {"word": "need"}, {"word": "gonna"}, {"word": "never"}, {"word": "we're"}, {"word": "too"}, {"word": "love"}, {"word": "she's"}, {"word": "I've"}, {"word": "sure"}, {"word": "them"}, {"word": "more"}, {"word": "over"}, {"word": "our"}, {"word": "sorry"}, {"word": "where"}, {"word": "what's"}, {"word": "let"}, {"word": "thing"}, {"word": "am"}, {"word": "maybe"}, {"word": "down"}, {"word": "man"}, {"word": "has"}, {"word": "uh"}, {"word": "very"}, {"word": "by"}, {"word": "there's"}, {"word": "should"}, {"word": "anything"}, {"word": "said"}, {"word": "much"}, {"word": "any"}, {"word": "life"}, {"word": "even"}, {"word": "off"}, {"word": "please"}, {"word": "doing"}, {"word": "thank"}, {"word": "give"}, {"word": "only"}, {"word": "thought"}, {"word": "help"}, {"word": "two"}, {"word": "talk"}, {"word": "people"}, {"word": "god"}, {"word": "still"}, {"word": "wait"}, {"word": "into"}, {"word": "find"}, {"word": "nothing"}, {"word": "again"}, {"word": "things"}, {"word": "let's"}, {"word": "doesn't"}, {"word": "call"}, {"word": "told"}, {"word": "great"}, {"word": "before"}, {"word": "better"}, {"word": "ever"}, {"word": "night"}, {"word": "than"}, {"word": "away"}, {"word": "first"}, {"word": "believe"}, {"word": "other"}, {"word": "feel"}, {"word": "everything"}, {"word": "work"}, {"word": "you've"}, {"word": "fine"}, {"word": "home"}, {"word": "after"}, {"word": "last"}, {"word": "these"}, {"word": "day"}, {"word": "keep"}, {"word": "does"}, {"word": "put"}, {"word": "around"}, {"word": "stop"}, {"word": "they're"}, {"word": "I'd"}, {"word": "guy"}, {"word": "long"}, {"word": "isn't"}, {"word": "always"}, {"word": "listen"}, {"word": "wanted"}, {"word": "Mr."}, {"word": "guys"}, {"word": "huh"}, {"word": "those"}, {"word": "big"}, {"word": "lot"}, {"word": "happened"}, {"word": "thanks"}, {"word": "won't"}, {"word": "trying"}, {"word": "kind"}, {"word": "wrong"}, {"word": "through"}, {"word": "talking"}, {"word": "made"}, {"word": "new"}, {"word": "being"}, {"word": "guess"}, {"word": "hi"}, {"word": "care"}, {"word": "bad"}, {"word": "mom"}, {"word": "remember"}, {"word": "getting"}, {"word": "we'll"}, {"word": "together"}, {"word": "dad"}, {"word": "leave"}, {"word": "mother"}, {"word": "place"}, {"word": "understand"}, {"word": "wouldn't"}, {"word": "actually"}, {"word": "hear"}, {"word": "baby"}, {"word": "nice"}, {"word": "father"}, {"word": "else"}, {"word": "stay"}, {"word": "done"}, {"word": "wasn't"}, {"word": "their"}, {"word": "course"}, {"word": "might"}, {"word": "mind"}, {"word": "every"}, {"word": "enough"}, {"word": "try"}, {"word": "hell"}, {"word": "came"}, {"word": "someone"}, {"word": "you'll"}, {"word": "own"}, {"word": "family"}, {"word": "whole"}, {"word": "another"}, {"word": "house or House"}, {"word": "Jack or jack"}, {"word": "yourself"}, {"word": "idea"}, {"word": "ask"}, {"word": "best"}, {"word": "must"}, {"word": "coming"}, {"word": "old"}, {"word": "looking"}, {"word": "woman"}, {"word": "hello"}, {"word": "which"}, {"word": "years"}, {"word": "room"}, {"word": "money"}, {"word": "left"}, {"word": "knew"}, {"word": "tonight"}, {"word": "real"}, {"word": "son"}, {"word": "hope"}, {"word": "name"}, {"word": "same"}, {"word": "went"}, {"word": "um"}, {"word": "hmm"}, {"word": "happy"}, {"word": "pretty"}, {"word": "saw"}, {"word": "girl"}, {"word": "sir"}, {"word": "show"}, {"word": "friend"}, {"word": "already"}, {"word": "saying"}, {"word": "may or May"}, {"word": "next"}, {"word": "three"}, {"word": "job"}, {"word": "problem"}, {"word": "minute"}, {"word": "found"}, {"word": "world"}, {"word": "thinking"}, {"word": "haven't"}, {"word": "heard"}, {"word": "honey"}, {"word": "matter"}, {"word": "myself"}, {"word": "couldn't"}, {"word": "exactly"}, {"word": "having"}, {"word": "ah"}, {"word": "probably"}, {"word": "happen"}, {"word": "we've"}, {"word": "hurt"}, {"word": "boy"}, {"word": "both"}, {"word": "while"}, {"word": "dead"}, {"word": "gotta"}, {"word": "alone"}, {"word": "since"}, {"word": "excuse"}, {"word": "start"}, {"word": "kill"}, {"word": "hard"}, {"word": "you'd"}, {"word": "today"}, {"word": "car"}, {"word": "ready"}, {"word": "until"}, {"word": "without"}, {"word": "whatever"}, {"word": "wants"}, {"word": "hold"}, {"word": "wanna"}, {"word": "yet"}, {"word": "seen"}, {"word": "deal"}, {"word": "took"}, {"word": "once"}, {"word": "gone"}, {"word": "called"}, {"word": "morning"}, {"word": "supposed"}, {"word": "friends"}, {"word": "head"}, {"word": "stuff"}, {"word": "most"}, {"word": "used"}, {"word": "worry"}, {"word": "second"}, {"word": "part"}, {"word": "live"}, {"word": "truth"}, {"word": "school"}, {"word": "face"}, {"word": "forget"}, {"word": "true"}, {"word": "business"}, {"word": "each"}, {"word": "cause"}, {"word": "soon"}, {"word": "knows"}, {"word": "few"}, {"word": "telling"}, {"word": "wife"}, {"word": "who's"}, {"word": "use"}, {"word": "chance"}, {"word": "run"}, {"word": "move"}, {"word": "anyone"}, {"word": "person"}, {"word": "bye"}, {"word": "J."}, {"word": "somebody"}, {"word": "Dr. or dr."}, {"word": "heart"}, {"word": "such"}, {"word": "miss"}, {"word": "married"}, {"word": "point"}, {"word": "later"}, {"word": "making"}, {"word": "meet"}, {"word": "anyway"}, {"word": "many"}, {"word": "phone"}, {"word": "reason"}, {"word": "damn"}, {"word": "lost"}, {"word": "looks"}, {"word": "bring"}, {"word": "case"}, {"word": "turn"}, {"word": "wish"}, {"word": "tomorrow"}, {"word": "kids"}, {"word": "trust"}, {"word": "check"}, {"word": "change"}, {"word": "end"}, {"word": "late"}, {"word": "anymore"}, {"word": "five"}, {"word": "least"}, {"word": "town"}, {"word": "aren't"}, {"word": "ha"}, {"word": "working"}, {"word": "year"}, {"word": "makes"}, {"word": "taking"}, {"word": "means"}, {"word": "brother"}, {"word": "play"}, {"word": "hate"}, {"word": "ago"}, {"word": "says"}, {"word": "beautiful"}, {"word": "gave"}, {"word": "fact"}, {"word": "crazy"}, {"word": "party"}, {"word": "sit"}, {"word": "open"}, {"word": "afraid"}, {"word": "between"}, {"word": "important"}, {"word": "rest"}, {"word": "fun"}, {"word": "kid"}, {"word": "word"}, {"word": "watch"}, {"word": "glad"}, {"word": "everyone"}, {"word": "days"}, {"word": "sister"}, {"word": "minutes"}, {"word": "everybody"}, {"word": "bit"}, {"word": "couple"}, {"word": "whoa"}, {"word": "either"}, {"word": "Mrs."}, {"word": "feeling"}, {"word": "daughter"}, {"word": "wow"}, {"word": "gets"}, {"word": "asked"}, {"word": "under"}, {"word": "break"}, {"word": "promise"}, {"word": "door"}, {"word": "set"}, {"word": "close"}, {"word": "hand"}, {"word": "easy"}, {"word": "question"}, {"word": "doctor"}, {"word": "tried"}, {"word": "far"}, {"word": "walk"}, {"word": "needs"}, {"word": "trouble"}, {"word": "mine"}, {"word": "though"}, {"word": "times"}, {"word": "different"}, {"word": "killed"}, {"word": "hospital"}, {"word": "anybody"}, {"word": "Sam or SAM"}, {"word": "alright"}, {"word": "wedding"}, {"word": "shut"}, {"word": "able"}, {"word": "die"}, {"word": "perfect"}, {"word": "police"}, {"word": "stand"}, {"word": "comes"}, {"word": "hit"}, {"word": "story"}, {"word": "ya"}, {"word": "mm"}, {"word": "waiting"}, {"word": "dinner"}, {"word": "against"}, {"word": "funny"}, {"word": "husband"}, {"word": "almost"}, {"word": "stupid"}, {"word": "pay"}, {"word": "answer"}, {"word": "four"}, {"word": "office"}, {"word": "cool"}, {"word": "eyes"}, {"word": "news"}, {"word": "child"}, {"word": "shouldn't"}, {"word": "half"}, {"word": "side"}, {"word": "yours"}, {"word": "moment"}, {"word": "sleep"}, {"word": "read"}, {"word": "where's"}, {"word": "started"}, {"word": "young"}, {"word": "men"}, {"word": "sounds"}, {"word": "sonny or Sonny"}, {"word": "lucky"}, {"word": "pick"}, {"word": "sometimes"}, {"word": "'em"}, {"word": "bed"}, {"word": "also"}, {"word": "date"}, {"word": "line"}, {"word": "plan"}, {"word": "hours"}, {"word": "lose"}, {"word": "fire"}, {"word": "free"}, {"word": "hands"}, {"word": "serious"}, {"word": "Leo"}, {"word": "shit"}, {"word": "behind"}, {"word": "inside"}, {"word": "high"}, {"word": "ahead"}, {"word": "week"}, {"word": "wonderful"}, {"word": "T."}, {"word": "fight"}, {"word": "past"}, {"word": "cut"}, {"word": "quite"}, {"word": "number"}, {"word": "he'll"}, {"word": "sick"}, {"word": "S."}, {"word": "it'll"}, {"word": "game"}, {"word": "eat"}, {"word": "nobody"}, {"word": "goes"}, {"word": "death"}, {"word": "along"}, {"word": "save"}, {"word": "seems"}, {"word": "finally"}, {"word": "lives"}, {"word": "worried"}, {"word": "upset"}, {"word": "Theresa"}, {"word": "Carly"}, {"word": "Ethan"}, {"word": "met"}, {"word": "book"}, {"word": "brought"}, {"word": "seem"}, {"word": "sort"}, {"word": "safe"}, {"word": "living"}, {"word": "children"}, {"word": "weren't"}, {"word": "leaving"}, {"word": "front"}, {"word": "shot"}, {"word": "loved"}, {"word": "asking"}, {"word": "running"}, {"word": "clear"}, {"word": "figure"}, {"word": "hot"}, {"word": "felt"}, {"word": "six"}, {"word": "parents"}, {"word": "drink"}, {"word": "absolutely"}, {"word": "how's"}, {"word": "daddy"}, {"word": "sweet"}, {"word": "alive"}, {"word": "Paul"}, {"word": "sense"}, {"word": "meant"}, {"word": "happens"}, {"word": "David"}, {"word": "special"}, {"word": "bet"}, {"word": "blood"}, {"word": "ain't"}, {"word": "kidding"}, {"word": "lie"}, {"word": "full"}, {"word": "meeting"}, {"word": "dear"}, {"word": "coffee"}, {"word": "seeing"}, {"word": "sound"}, {"word": "fault"}, {"word": "water"}, {"word": "fuck"}, {"word": "ten"}, {"word": "women"}, {"word": "John or john"}, {"word": "welcome"}, {"word": "buy"}, {"word": "months"}, {"word": "hour"}, {"word": "speak"}, {"word": "lady"}, {"word": "Jen"}, {"word": "thinks"}, {"word": "Christmas"}, {"word": "body"}, {"word": "order"}, {"word": "outside"}, {"word": "hang"}, {"word": "possible"}, {"word": "worse"}, {"word": "company"}, {"word": "mistake"}, {"word": "ooh"}, {"word": "handle"}, {"word": "spend"}, {"word": "C."}, {"word": "totally"}, {"word": "giving"}, {"word": "control"}, {"word": "here's"}, {"word": "marriage"}, {"word": "realize"}, {"word": "D."}, {"word": "power"}, {"word": "president"}, {"word": "unless"}, {"word": "sex"}, {"word": "girls"}, {"word": "send"}, {"word": "needed"}, {"word": "O. or o"}, {"word": "taken"}, {"word": "died"}, {"word": "scared"}, {"word": "picture"}, {"word": "talked"}, {"word": "Jake"}, {"word": "Al"}, {"word": "ass"}, {"word": "hundred"}, {"word": "changed"}, {"word": "completely"}, {"word": "explain"}, {"word": "playing"}, {"word": "certainly"}, {"word": "sign"}, {"word": "boys"}, {"word": "relationship"}, {"word": "Michael"}, {"word": "loves"}, {"word": "fucking"}, {"word": "hair"}, {"word": "lying"}, {"word": "choice"}, {"word": "anywhere"}, {"word": "secret"}, {"word": "future"}, {"word": "weird"}, {"word": "luck"}, {"word": "she'll"}, {"word": "Max or max."}, {"word": "Luis"}, {"word": "turned"}, {"word": "known"}, {"word": "touch"}, {"word": "kiss"}, {"word": "Crane or crane"}, {"word": "questions"}, {"word": "obviously"}, {"word": "wonder"}, {"word": "pain"}, {"word": "calling"}, {"word": "somewhere"}, {"word": "throw"}, {"word": "straight"}, {"word": "Grace or grace"}, {"word": "cold"}, {"word": "white or White"}, {"word": "fast"}, {"word": "Natalie"}, {"word": "words"}, {"word": "R."}, {"word": "food"}, {"word": "none"}, {"word": "drive"}, {"word": "feelings"}, {"word": "they'll"}, {"word": "worked"}, {"word": "marry"}, {"word": "light"}, {"word": "test"}, {"word": "drop"}, {"word": "cannot"}, {"word": "Frank"}, {"word": "sent"}, {"word": "city"}, {"word": "dream"}, {"word": "protect"}, {"word": "twenty"}, {"word": "class"}, {"word": "Lucy"}, {"word": "surprise"}, {"word": "its"}, {"word": "sweetheart"}, {"word": "forever"}, {"word": "poor"}, {"word": "looked"}, {"word": "mad"}, {"word": "except"}, {"word": "gun"}, {"word": "y'know"}, {"word": "dance"}, {"word": "takes"}, {"word": "appreciate"}, {"word": "especially"}, {"word": "situation"}, {"word": "besides"}, {"word": "weeks"}, {"word": "pull"}, {"word": "himself"}, {"word": "hasn't"}, {"word": "act"}, {"word": "worth"}, {"word": "Sheridan"}, {"word": "amazing"}, {"word": "top"}, {"word": "given"}, {"word": "expect"}, {"word": "Ben"}, {"word": "rather"}, {"word": "Julian"}, {"word": "involved"}, {"word": "swear"}, {"word": "piece"}, {"word": "busy"}, {"word": "law"}, {"word": "decided"}, {"word": "black or Black"}, {"word": "Joey"}, {"word": "happening"}, {"word": "movie"}, {"word": "we'd"}, {"word": "catch"}, {"word": "Antonio"}, {"word": "country"}, {"word": "less"}, {"word": "perhaps"}, {"word": "step"}, {"word": "fall"}, {"word": "watching"}, {"word": "kept"}, {"word": "darling"}, {"word": "dog"}, {"word": "Ms."}, {"word": "win"}, {"word": "air"}, {"word": "honor"}, {"word": "personal"}, {"word": "moving"}, {"word": "till"}, {"word": "admit"}, {"word": "problems"}, {"word": "murder"}, {"word": "strong"}, {"word": "he'd"}, {"word": "evil"}, {"word": "definitely"}, {"word": "feels"}, {"word": "information"}, {"word": "honest"}, {"word": "eye"}, {"word": "broke"}, {"word": "missed"}, {"word": "longer"}, {"word": "dollars"}, {"word": "tired"}, {"word": "Jason"}, {"word": "George"}, {"word": "evening"}, {"word": "human"}, {"word": "starting"}, {"word": "Ross"}, {"word": "red"}, {"word": "entire"}, {"word": "trip"}, {"word": "Brooke"}, {"word": "E."}, {"word": "club"}, {"word": "Niles"}, {"word": "suppose"}, {"word": "calm"}, {"word": "imagine"}, {"word": "Todd"}, {"word": "fair"}, {"word": "caught"}, {"word": "B."}, {"word": "blame"}, {"word": "street"}, {"word": "sitting"}, {"word": "favor"}, {"word": "apartment"}, {"word": "court"}, {"word": "terrible"}, {"word": "clean"}, {"word": "Tony or tony"}, {"word": "learn"}, {"word": "Alison"}, {"word": "Rick"}, {"word": "works"}, {"word": "Rose or rose"}, {"word": "Frasier"}, {"word": "relax"}, {"word": "York"}, {"word": "million"}, {"word": "charity"}, {"word": "accident"}, {"word": "wake"}, {"word": "prove"}, {"word": "Danny"}, {"word": "smart"}, {"word": "message"}, {"word": "missing"}, {"word": "forgot"}, {"word": "small"}, {"word": "interested"}, {"word": "table"}, {"word": "nbsp"}, {"word": "become"}, {"word": "Craig"}, {"word": "mouth"}, {"word": "pregnant"}, {"word": "middle"}, {"word": "Billy or billy"}, {"word": "ring"}, {"word": "careful"}, {"word": "shall"}, {"word": "dude"}, {"word": "team"}, {"word": "ride"}, {"word": "figured"}, {"word": "wear"}, {"word": "shoot"}, {"word": "stick"}, {"word": "Ray or ray"}, {"word": "follow"}, {"word": "Bo"}, {"word": "angry"}, {"word": "instead"}, {"word": "buddy"}, {"word": "write"}, {"word": "stopped"}, {"word": "early"}, {"word": "Angel or angel"}, {"word": "Nick or nick"}, {"word": "ran"}, {"word": "war"}, {"word": "standing"}, {"word": "forgive"}, {"word": "jail"}, {"word": "wearing"}, {"word": "Miguel"}, {"word": "ladies"}, {"word": "kinda"}, {"word": "lunch"}, {"word": "Cristian"}, {"word": "eight"}, {"word": "Greenlee"}, {"word": "gotten"}, {"word": "hoping"}, {"word": "Phoebe"}, {"word": "thousand"}, {"word": "ridge"}, {"word": "music"}, {"word": "Luke"}, {"word": "paper"}, {"word": "tough"}, {"word": "tape"}, {"word": "Emily"}, {"word": "state"}, {"word": "count"}, {"word": "college"}, {"word": "boyfriend"}, {"word": "proud"}, {"word": "agree"}, {"word": "birthday"}, {"word": "bill"}, {"word": "seven"}, {"word": "they've"}, {"word": "Timmy"}, {"word": "history"}, {"word": "share"}, {"word": "offer"}, {"word": "hurry"}, {"word": "ow"}, {"word": "feet"}, {"word": "wondering"}, {"word": "simple"}, {"word": "decision"}, {"word": "building"}, {"word": "ones"}, {"word": "finish"}, {"word": "voice"}, {"word": "herself"}, {"word": "Chris"}, {"word": "would've"}, {"word": "list"}, {"word": "Kay"}, {"word": "mess"}, {"word": "deserve"}, {"word": "evidence"}, {"word": "cute"}, {"word": "Jerry"}, {"word": "dress"}, {"word": "Richard"}, {"word": "interesting"}, {"word": "Jesus"}, {"word": "James"}, {"word": "hotel"}, {"word": "enjoy"}, {"word": "Ryan"}, {"word": "Lindsay"}, {"word": "quiet"}, {"word": "concerned"}, {"word": "road"}, {"word": "Eve or eve"}, {"word": "staying"}, {"word": "short"}, {"word": "M."}, {"word": "beat"}, {"word": "sweetie"}, {"word": "mention"}, {"word": "clothes"}, {"word": "finished"}, {"word": "fell"}, {"word": "neither"}, {"word": "mmm"}, {"word": "fix"}, {"word": "Victor or victor"}, {"word": "respect"}, {"word": "spent"}, {"word": "prison"}, {"word": "attention"}, {"word": "holding"}, {"word": "calls"}, {"word": "near"}, {"word": "surprised"}, {"word": "bar"}, {"word": "Beth"}, {"word": "pass"}, {"word": "keeping"}, {"word": "gift"}, {"word": "hadn't"}, {"word": "putting"}, {"word": "dark"}, {"word": "self"}, {"word": "owe"}, {"word": "using"}, {"word": "Nora"}, {"word": "ice"}, {"word": "helping"}, {"word": "bitch"}, {"word": "normal"}, {"word": "aunt"}, {"word": "lawyer"}, {"word": "apart"}, {"word": "certain"}, {"word": "plans"}, {"word": "Jax"}, {"word": "girlfriend"}, {"word": "floor"}, {"word": "whether"}, {"word": "everything's"}, {"word": "present"}, {"word": "earth"}, {"word": "private"}, {"word": "Jessica"}, {"word": "box"}, {"word": "Dawson"}, {"word": "cover"}, {"word": "judge"}, {"word": "upstairs"}, {"word": "Alexis"}, {"word": "Shawn"}, {"word": "sake"}, {"word": "mommy"}, {"word": "possibly"}, {"word": "worst"}, {"word": "station"}, {"word": "acting"}, {"word": "accept"}, {"word": "blow"}, {"word": "strange"}, {"word": "saved"}, {"word": "Ivy or ivy"}, {"word": "conversation"}, {"word": "plane"}, {"word": "mama"}, {"word": "yesterday"}, {"word": "lied"}, {"word": "quick"}, {"word": "lately"}, {"word": "stuck"}, {"word": "lovely"}, {"word": "security"}, {"word": "report"}, {"word": "Barbara"}, {"word": "difference"}, {"word": "rid"}, {"word": "tv or TV"}, {"word": "Adam"}, {"word": "store"}, {"word": "she'd"}, {"word": "bag"}, {"word": "Mike"}, {"word": "bought"}, {"word": "ball"}, {"word": "single"}, {"word": "Kevin"}, {"word": "doubt"}, {"word": "listening"}, {"word": "major"}, {"word": "walking"}, {"word": "cops"}, {"word": "blue"}, {"word": "deep"}, {"word": "dangerous"}, {"word": "Buffy"}, {"word": "park or Park"}, {"word": "sleeping"}, {"word": "Chloe"}, {"word": "Rafe"}, {"word": "shh"}, {"word": "record"}, {"word": "lord"}, {"word": "Erica"}, {"word": "moved"}, {"word": "join"}, {"word": "key"}, {"word": "captain"}, {"word": "card"}, {"word": "crime"}, {"word": "gentlemen"}, {"word": "willing"}, {"word": "window"}, {"word": "return"}, {"word": "walked"}, {"word": "guilty"}, {"word": "Brenda"}, {"word": "likes"}, {"word": "fighting"}, {"word": "difficult"}, {"word": "soul"}, {"word": "joke"}, {"word": "service"}, {"word": "magic"}, {"word": "favorite"}, {"word": "uncle"}, {"word": "promised"}, {"word": "public"}, {"word": "bother"}, {"word": "island"}, {"word": "Jim"}, {"word": "seriously"}, {"word": "cell"}, {"word": "lead"}, {"word": "knowing"}, {"word": "broken"}, {"word": "advice"}, {"word": "somehow"}, {"word": "paid"}, {"word": "Blair"}, {"word": "losing"}, {"word": "push"}, {"word": "helped"}, {"word": "killing"}, {"word": "usually"}, {"word": "earlier"}, {"word": "boss"}, {"word": "Laura"}, {"word": "beginning"}, {"word": "liked"}, {"word": "innocent"}, {"word": "doc"}, {"word": "rules"}, {"word": "Elizabeth"}, {"word": "Sabrina"}, {"word": "summer or Summer"}, {"word": "ex"}, {"word": "cop"}, {"word": "learned"}, {"word": "thirty"}, {"word": "risk"}, {"word": "letting"}, {"word": "Phillip"}, {"word": "speaking"}, {"word": "officer"}, {"word": "ridiculous"}, {"word": "support"}, {"word": "afternoon"}, {"word": "Eric"}, {"word": "born"}, {"word": "dreams"}, {"word": "apologize"}, {"word": "seat"}, {"word": "nervous"}, {"word": "across"}, {"word": "song"}, {"word": "Olivia"}, {"word": "charge"}, {"word": "patient"}, {"word": "Cassie"}, {"word": "boat"}, {"word": "how'd"}, {"word": "brain"}, {"word": "hide"}, {"word": "detective"}, {"word": "Aaron"}, {"word": "Kendall"}, {"word": "general"}, {"word": "Tom"}, {"word": "planning"}, {"word": "nine"}, {"word": "huge"}, {"word": "breakfast"}, {"word": "horrible"}, {"word": "age"}, {"word": "awful"}, {"word": "pleasure"}, {"word": "driving"}, {"word": "hanging"}, {"word": "picked"}, {"word": "system"}, {"word": "sell"}, {"word": "quit"}, {"word": "apparently"}, {"word": "dying"}, {"word": "notice"}, {"word": "Josh"}, {"word": "congratulations"}, {"word": "chief"}, {"word": "faith"}, {"word": "Simon"}, {"word": "gay"}, {"word": "ho or Ho"}, {"word": "one's"}, {"word": "month"}, {"word": "visit"}, {"word": "Hal"}, {"word": "could've"}, {"word": "c'mon"}, {"word": "aw"}, {"word": "Edmund"}, {"word": "Brady"}, {"word": "letter"}, {"word": "decide"}, {"word": "American"}, {"word": "double"}, {"word": "Troy"}, {"word": "sad"}, {"word": "press"}, {"word": "forward"}, {"word": "fool"}, {"word": "showed"}, {"word": "smell"}, {"word": "seemed"}, {"word": "Mary"}, {"word": "spell"}, {"word": "Courtney"}, {"word": "memory"}, {"word": "Mark or mark"}, {"word": "Alan"}, {"word": "pictures"}, {"word": "Paris"}, {"word": "slow"}, {"word": "Joe or joe"}, {"word": "Tim"}, {"word": "seconds"}, {"word": "hungry"}, {"word": "board"}, {"word": "position"}, {"word": "hearing"}, {"word": "Roz"}, {"word": "kitchen"}, {"word": "ma'am"}, {"word": "Bob or bob"}, {"word": "force"}, {"word": "fly"}, {"word": "during"}, {"word": "space"}, {"word": "should've"}, {"word": "realized"}, {"word": "experience"}, {"word": "kick"}, {"word": "others"}, {"word": "grab"}, {"word": "mother's"}, {"word": "P."}, {"word": "Sharon"}, {"word": "discuss"}, {"word": "third"}, {"word": "cat or Cat"}, {"word": "fifty"}, {"word": "responsible"}, {"word": "Jennifer"}, {"word": "Philip"}, {"word": "miles or Miles"}, {"word": "fat"}, {"word": "reading"}, {"word": "idiot"}, {"word": "yep"}, {"word": "rock"}, {"word": "rich"}, {"word": "suddenly"}, {"word": "agent"}, {"word": "bunch"}, {"word": "destroy"}, {"word": "bucks"}, {"word": "track"}, {"word": "shoes"}, {"word": "scene"}, {"word": "peace"}, {"word": "arms"}, {"word": "demon"}, {"word": "Diane"}, {"word": "Bridget"}, {"word": "Brad"}, {"word": "low"}, {"word": "Livvie"}, {"word": "consider"}, {"word": "papers"}, {"word": "medical"}, {"word": "incredible"}, {"word": "witch"}, {"word": "er"}, {"word": "drunk"}, {"word": "attorney"}, {"word": "Charlie"}, {"word": "tells"}, {"word": "knock"}, {"word": "Karen"}, {"word": "ways"}, {"word": "eh"}, {"word": "belle or Belle"}, {"word": "cash or Cash"}, {"word": "gives"}, {"word": "department"}, {"word": "nose"}, {"word": "Skye"}, {"word": "turns"}, {"word": "keeps"}, {"word": "beer"}, {"word": "jealous"}, {"word": "drug"}, {"word": "Molly"}, {"word": "sooner"}, {"word": "cares"}, {"word": "plenty"}, {"word": "extra"}, {"word": "tea"}, {"word": "won"}, {"word": "attack"}, {"word": "ground"}, {"word": "whose"}, {"word": "outta"}, {"word": "Kyle"}, {"word": "L."}, {"word": "weekend"}, {"word": "matters"}, {"word": "wrote"}, {"word": "type"}, {"word": "father's"}, {"word": "Alex"}, {"word": "gosh"}, {"word": "opportunity"}, {"word": "king"}, {"word": "impossible"}, {"word": "books"}, {"word": "machine"}, {"word": "waste"}, {"word": "th"}, {"word": "pretend"}, {"word": "named"}, {"word": "danger"}, {"word": "wall"}, {"word": "Liz"}, {"word": "Ian"}, {"word": "Henry"}, {"word": "jump"}, {"word": "eating"}, {"word": "proof"}, {"word": "complete"}, {"word": "slept"}, {"word": "career"}, {"word": "arrest"}, {"word": "star"}, {"word": "Phyllis"}, {"word": "Mac"}, {"word": "breathe"}, {"word": "perfectly"}, {"word": "warm"}, {"word": "pulled"}, {"word": "Maria"}, {"word": "twice"}, {"word": "easier"}, {"word": "killer"}, {"word": "goin'"}, {"word": "dating"}, {"word": "suit"}, {"word": "romantic"}, {"word": "drugs"}, {"word": "comfortable"}, {"word": "Isaac"}, {"word": "powers or Powers"}, {"word": "finds"}, {"word": "checked"}, {"word": "fit"}, {"word": "divorce"}, {"word": "begin"}, {"word": "ourselves"}, {"word": "closer"}, {"word": "ruin"}, {"word": "although"}, {"word": "smile"}, {"word": "laugh"}, {"word": "fish"}, {"word": "Abigail"}, {"word": "treat"}, {"word": "god's"}, {"word": "fear"}, {"word": "Anna"}, {"word": "what'd"}, {"word": "Simone"}, {"word": "Amber"}, {"word": "guy's"}, {"word": "otherwise"}, {"word": "excited"}, {"word": "mail"}, {"word": "hiding"}, {"word": "cost"}, {"word": "green or Green"}, {"word": "stole"}, {"word": "Pacey"}, {"word": "noticed"}, {"word": "Liza"}, {"word": "fired"}, {"word": "Daphne"}, {"word": "Whitney"}, {"word": "excellent"}, {"word": "lived"}, {"word": "bringing"}, {"word": "pop"}, {"word": "piper or Piper"}, {"word": "bottom"}, {"word": "note"}, {"word": "sudden"}, {"word": "church"}, {"word": "bathroom"}, {"word": "flight"}, {"word": "Chad or chad"}, {"word": "la or LA"}, {"word": "honestly"}, {"word": "sing"}, {"word": "Katie"}, {"word": "foot"}, {"word": "games"}, {"word": "glass"}, {"word": "N."}, {"word": "Mitch"}, {"word": "remind"}, {"word": "bank"}, {"word": "Rory"}, {"word": "charges"}, {"word": "witness"}, {"word": "finding"}, {"word": "places"}, {"word": "tree"}, {"word": "dare"}, {"word": "hardly"}, {"word": "that'll"}, {"word": "U."}, {"word": "interest"}, {"word": "steal"}, {"word": "princess"}, {"word": "silly"}, {"word": "contact"}, {"word": "teach"}, {"word": "shop"}, {"word": "plus"}, {"word": "colonel"}, {"word": "fresh"}, {"word": "trial"}, {"word": "invited"}, {"word": "roll"}, {"word": "radio"}, {"word": "art"}, {"word": "reach"}, {"word": "heh"}, {"word": "dirty"}, {"word": "choose"}, {"word": "emergency"}, {"word": "dropped"}, {"word": "butt"}, {"word": "credit"}, {"word": "obvious"}, {"word": "cry"}, {"word": "locked"}, {"word": "Larry"}, {"word": "loving"}, {"word": "positive"}, {"word": "nuts"}, {"word": "agreed"}, {"word": "Prue"}, {"word": "price or Price"}, {"word": "goodbye"}, {"word": "condition"}, {"word": "guard"}, {"word": "fuckin'"}, {"word": "grow"}, {"word": "cake"}, {"word": "mood"}, {"word": "dad's"}, {"word": "Bianca"}, {"word": "total"}, {"word": "crap"}, {"word": "crying"}, {"word": "Paige"}, {"word": "K. or 'k"}, {"word": "belong"}, {"word": "lay"}, {"word": "partner"}, {"word": "trick"}, {"word": "pressure"}, {"word": "ohh"}, {"word": "arm"}, {"word": "dressed"}, {"word": "cup"}, {"word": "lies"}, {"word": "bus"}, {"word": "taste"}, {"word": "neck"}, {"word": "south"}, {"word": "something's"}, {"word": "nurse"}, {"word": "raise"}, {"word": "land"}, {"word": "cross"}, {"word": "lots"}, {"word": "mister"}, {"word": "carry"}, {"word": "group"}, {"word": "whoever"}, {"word": "Eddie"}, {"word": "drinking"}, {"word": "they'd"}, {"word": "breaking"}, {"word": "file"}, {"word": "lock"}, {"word": "computer"}, {"word": "yo"}, {"word": "Rebecca"}, {"word": "wine"}, {"word": "closed"}, {"word": "writing"}, {"word": "spot"}, {"word": "paying"}, {"word": "study"}, {"word": "assume"}, {"word": "asleep"}, {"word": "man's"}, {"word": "turning"}, {"word": "legal"}, {"word": "justice"}, {"word": "Viki"}, {"word": "Chandler"}, {"word": "bedroom"}, {"word": "shower"}, {"word": "Nikolas"}, {"word": "camera"}, {"word": "fill"}, {"word": "reasons"}, {"word": "forty"}, {"word": "bigger"}, {"word": "nope"}, {"word": "keys"}, {"word": "Starr"}, {"word": "breath"}, {"word": "doctors"}, {"word": "pants"}, {"word": "freak"}, {"word": "level"}, {"word": "French"}, {"word": "movies"}, {"word": "gee"}, {"word": "Monica"}, {"word": "action"}, {"word": "area"}, {"word": "folks"}, {"word": "Steve"}, {"word": "cream"}, {"word": "ugh"}, {"word": "continue"}, {"word": "focus"}, {"word": "wild"}, {"word": "truly"}, {"word": "Jill or jill"}, {"word": "desk"}, {"word": "convince"}, {"word": "client"}, {"word": "threw"}, {"word": "Taylor"}, {"word": "band"}, {"word": "hurts"}, {"word": "Charles"}, {"word": "spending"}, {"word": "Neil"}, {"word": "field or Field"}, {"word": "allow"}, {"word": "grand"}, {"word": "answers"}, {"word": "shirt"}, {"word": "chair"}, {"word": "Christ or christ"}, {"word": "allowed"}, {"word": "rough"}, {"word": "doin"}, {"word": "sees"}, {"word": "government"}, {"word": "Harry"}, {"word": "ought"}, {"word": "empty"}, {"word": "round"}, {"word": "lights"}, {"word": "insane"}, {"word": "hall or Hall"}, {"word": "hat"}, {"word": "bastard"}, {"word": "wind"}, {"word": "shows"}, {"word": "aware"}, {"word": "dealing"}, {"word": "pack"}, {"word": "meaning"}, {"word": "flowers"}, {"word": "tight"}, {"word": "hurting"}, {"word": "ship"}, {"word": "subject"}, {"word": "guest"}, {"word": "mom's"}, {"word": "chicken"}, {"word": "pal"}, {"word": "match"}, {"word": "Elaine"}, {"word": "arrested"}, {"word": "sun"}, {"word": "Rachel"}, {"word": "Salem"}, {"word": "confused"}, {"word": "surgery"}, {"word": "expecting"}, {"word": "deacon"}, {"word": "Colleen"}, {"word": "unfortunately"}, {"word": "goddamn"}, {"word": "lab"}, {"word": "passed"}, {"word": "bottle"}, {"word": "beyond"}, {"word": "whenever"}, {"word": "pool"}, {"word": "opinion"}, {"word": "naked"}, {"word": "held"}, {"word": "common"}, {"word": "starts"}, {"word": "jerk"}, {"word": "secrets"}, {"word": "falling"}, {"word": "played"}, {"word": "necessary"}, {"word": "barely"}, {"word": "dancing"}, {"word": "health"}, {"word": "tests"}, {"word": "copy"}, {"word": "Keri"}, {"word": "video"}, {"word": "cousin"}, {"word": "planned"}, {"word": "Vanessa"}, {"word": "dry"}, {"word": "ahem"}, {"word": "twelve"}, {"word": "simply"}, {"word": "Tess"}, {"word": "Scott"}, {"word": "skin"}, {"word": "often"}, {"word": "English"}, {"word": "fifteen"}, {"word": "spirit"}, {"word": "speech"}, {"word": "names"}, {"word": "issue"}, {"word": "orders"}, {"word": "nah"}, {"word": "final"}, {"word": "Michelle"}, {"word": "America"}, {"word": "St."}, {"word": "results"}, {"word": "code"}, {"word": "Ned"}, {"word": "Bonnie"}, {"word": "W."}, {"word": "believed"}, {"word": "complicated"}, {"word": "umm"}, {"word": "research"}, {"word": "nowhere"}, {"word": "escape"}, {"word": "biggest"}, {"word": "restaurant"}, {"word": "page or Page"}, {"word": "grateful"}, {"word": "usual"}, {"word": "burn"}, {"word": "Chicago"}, {"word": "Austin"}, {"word": "address"}, {"word": "within"}, {"word": "someplace"}, {"word": "screw"}, {"word": "everywhere"}, {"word": "train"}, {"word": "film"}, {"word": "regret"}, {"word": "goodness"}, {"word": "mistakes"}, {"word": "heaven or Heaven"}, {"word": "details"}, {"word": "responsibility"}, {"word": "suspect"}, {"word": "corner"}, {"word": "hero"}, {"word": "dumb"}, {"word": "terrific"}, {"word": "Peter"}, {"word": "mission"}, {"word": "further"}, {"word": "Amy"}, {"word": "gas"}, {"word": "whoo"}, {"word": "hole"}, {"word": "memories"}, {"word": "o'clock"}, {"word": "Brian"}, {"word": "truck"}, {"word": "following"}, {"word": "ended"}, {"word": "nobody's"}, {"word": "Margo"}, {"word": "teeth"}, {"word": "ruined"}, {"word": "Hank"}, {"word": "split"}, {"word": "Reva"}, {"word": "bear"}, {"word": "airport"}, {"word": "bite"}, {"word": "smoke"}, {"word": "Stenbeck"}, {"word": "older"}, {"word": "liar"}, {"word": "horse"}, {"word": "Gwen"}, {"word": "showing"}, {"word": "van or Van"}, {"word": "project"}, {"word": "cards"}, {"word": "desperate"}, {"word": "themselves"}, {"word": "search"}, {"word": "pathetic"}, {"word": "damage"}, {"word": "spoke"}, {"word": "quickly"}, {"word": "scare"}, {"word": "Marah"}, {"word": "G."}, {"word": "beach"}, {"word": "Mia"}, {"word": "brown or Brown"}, {"word": "afford"}, {"word": "vote"}, {"word": "settle"}, {"word": "gold"}, {"word": "re or 're"}, {"word": "mentioned"}, {"word": "ed or -ed"}, {"word": "due"}, {"word": "passion"}, {"word": "Y. or -y"}, {"word": "stayed"}, {"word": "rule"}, {"word": "Friday"}, {"word": "checking"}, {"word": "tie"}, {"word": "hired"}, {"word": "upon"}, {"word": "rush or Rush"}, {"word": "Tad"}, {"word": "heads"}, {"word": "concern"}, {"word": "blew"}, {"word": "natural"}, {"word": "Alcazar"}, {"word": "Kramer"}, {"word": "champagne"}, {"word": "connection"}, {"word": "tickets"}, {"word": "Kate"}, {"word": "finger"}, {"word": "happiness"}, {"word": "form"}, {"word": "saving"}, {"word": "kissing"}, {"word": "Martin"}, {"word": "hated"}, {"word": "personally"}, {"word": "suggest"}, {"word": "prepared"}, {"word": "build"}, {"word": "leg"}, {"word": "onto"}, {"word": "leaves"}, {"word": "downstairs"}, {"word": "ticket"}, {"word": "it'd"}, {"word": "taught"}, {"word": "loose"}, {"word": "holy"}, {"word": "staff"}, {"word": "sea"}, {"word": "Asa"}, {"word": "planet"}, {"word": "duty"}, {"word": "convinced"}, {"word": "throwing"}, {"word": "defense"}, {"word": "Harvey"}, {"word": "kissed"}, {"word": "legs"}, {"word": "Dave"}, {"word": "according"}, {"word": "loud"}, {"word": "practice"}, {"word": "Andy"}, {"word": "Jess"}, {"word": "Saturday"}, {"word": "Colin"}, {"word": "bright or Bright"}, {"word": "Amanda"}, {"word": "Fraser"}, {"word": "F."}, {"word": "babies"}, {"word": "army"}, {"word": "where'd"}, {"word": "warning"}, {"word": "miracle"}, {"word": "carrying"}, {"word": "flying"}, {"word": "Caleb"}, {"word": "blind"}, {"word": "queen"}, {"word": "ugly"}, {"word": "shopping"}, {"word": "hates"}, {"word": "someone's"}, {"word": "Seth"}, {"word": "monster"}, {"word": "sight"}, {"word": "vampire"}, {"word": "Rosanna"}, {"word": "bride"}, {"word": "coat"}, {"word": "account"}, {"word": "states"}, {"word": "clearly"}, {"word": "celebrate"}, {"word": "Nicole"}, {"word": "brilliant"}, {"word": "wanting"}, {"word": "Allison"}, {"word": "add"}, {"word": "moon"}, {"word": "Forrester"}, {"word": "lips"}, {"word": "custody"}, {"word": "center"}, {"word": "screwed"}, {"word": "buying"}, {"word": "size"}, {"word": "toast"}, {"word": "thoughts"}, {"word": "Isabella"}, {"word": "student"}, {"word": "stories"}, {"word": "however"}, {"word": "professional"}, {"word": "stars"}, {"word": "reality"}, {"word": "Jimmy or jimmy"}, {"word": "birth"}, {"word": "Lexie"}, {"word": "attitude"}, {"word": "advantage"}, {"word": "grandfather"}, {"word": "Sami"}, {"word": "sold"}, {"word": "opened"}, {"word": "Lily"}, {"word": "grandma"}, {"word": "beg"}, {"word": "Edward"}, {"word": "changes"}, {"word": "Diego"}, {"word": "Cole"}, {"word": "someday"}, {"word": "grade"}, {"word": "cheese"}, {"word": "roof"}, {"word": "Kenny"}, {"word": "Bobby or bobby"}, {"word": "pizza"}, {"word": "brothers"}, {"word": "X. or x"}, {"word": "signed"}, {"word": "bird"}, {"word": "ahh"}, {"word": "marrying"}, {"word": "powerful"}, {"word": "grown"}, {"word": "grandmother"}, {"word": "fake"}, {"word": "opening"}, {"word": "Sally"}, {"word": "Stephanie"}, {"word": "expected"}, {"word": "eventually"}, {"word": "must've"}, {"word": "ideas"}, {"word": "exciting"}, {"word": "covered"}, {"word": "Parker"}, {"word": "de"}, {"word": "familiar"}, {"word": "bomb"}, {"word": "'bout"}, {"word": "television"}, {"word": "harmony or Harmony"}, {"word": "color"}, {"word": "heavy"}, {"word": "schedule"}, {"word": "records"}, {"word": "H."}, {"word": "dollar"}, {"word": "capable"}, {"word": "master"}, {"word": "numbers"}, {"word": "Toby"}, {"word": "practically"}, {"word": "including"}, {"word": "correct"}, {"word": "clue"}, {"word": "forgotten"}, {"word": "immediately"}, {"word": "appointment"}, {"word": "social"}, {"word": "nature"}, {"word": "\u00fa"}, {"word": "deserves"}, {"word": "west or West"}, {"word": "Blake"}, {"word": "teacher"}, {"word": "threat"}, {"word": "Frankie"}, {"word": "bloody"}, {"word": "lonely"}, {"word": "Kelly"}, {"word": "ordered"}, {"word": "shame"}, {"word": "Brittany"}, {"word": "local"}, {"word": "jacket"}, {"word": "hook"}, {"word": "destroyed"}, {"word": "scary"}, {"word": "loser"}, {"word": "investigation"}, {"word": "above"}, {"word": "Jamal"}, {"word": "invite"}, {"word": "shooting"}, {"word": "merry"}, {"word": "port"}, {"word": "precious"}, {"word": "lesson"}, {"word": "Roy"}, {"word": "criminal"}, {"word": "growing"}, {"word": "caused"}, {"word": "victim"}, {"word": "professor"}, {"word": "followed"}, {"word": "funeral"}, {"word": "nothing's"}, {"word": "dean"}, {"word": "considering"}, {"word": "burning"}, {"word": "couch"}, {"word": "strength"}, {"word": "harder"}, {"word": "loss"}, {"word": "view"}, {"word": "Gia"}, {"word": "beauty"}, {"word": "sisters"}, {"word": "everybody's"}, {"word": "several"}, {"word": "pushed"}, {"word": "Nicholas"}, {"word": "written"}, {"word": "somebody's"}, {"word": "shock"}, {"word": "pushing"}, {"word": "heat"}, {"word": "chocolate"}, {"word": "greatest"}, {"word": "Holden"}, {"word": "miserable"}, {"word": "Corinthos"}, {"word": "nightmare"}, {"word": "energy"}, {"word": "brings"}, {"word": "Zander"}, {"word": "character"}, {"word": "became"}, {"word": "famous"}, {"word": "enemy"}, {"word": "crash"}, {"word": "chances"}, {"word": "sending"}, {"word": "recognize"}, {"word": "healthy"}, {"word": "boring"}, {"word": "feed"}, {"word": "engaged"}, {"word": "Sarah"}, {"word": "percent"}, {"word": "headed"}, {"word": "Brandon"}, {"word": "lines"}, {"word": "treated"}, {"word": "purpose"}, {"word": "north or North"}, {"word": "knife"}, {"word": "rights"}, {"word": "drag"}, {"word": "San"}, {"word": "fan"}, {"word": "badly"}, {"word": "speed"}, {"word": "Santa"}, {"word": "hire"}, {"word": "curious"}, {"word": "paint"}, {"word": "pardon"}, {"word": "Jackson"}, {"word": "built"}, {"word": "behavior"}, {"word": "closet"}, {"word": "candy or Candy"}, {"word": "Helena"}, {"word": "warn"}, {"word": "gorgeous"}, {"word": "post"}, {"word": "milk"}, {"word": "survive"}, {"word": "forced"}, {"word": "daria"}, {"word": "victoria"}, {"word": "operation"}, {"word": "suck"}, {"word": "offered"}, {"word": "hm"}, {"word": "ends"}, {"word": "dump"}, {"word": "rent"}, {"word": "marshall"}, {"word": "remembered"}, {"word": "lieutenant"}, {"word": "trade"}, {"word": "thanksgiving"}, {"word": "rain"}, {"word": "revenge"}, {"word": "physical"}, {"word": "available"}, {"word": "program"}, {"word": "prefer"}, {"word": "baby's"}, {"word": "spare"}, {"word": "pray"}, {"word": "disappeared"}, {"word": "aside"}, {"word": "statement"}, {"word": "sometime"}, {"word": "animal"}, {"word": "sugar"}, {"word": "Ricky"}, {"word": "meat"}, {"word": "fantastic"}, {"word": "breathing"}, {"word": "laughing"}, {"word": "itself"}, {"word": "tip"}, {"word": "stood"}, {"word": "market"}, {"word": "Raul"}, {"word": "affair"}, {"word": "Stephen"}, {"word": "ours"}, {"word": "depends"}, {"word": "cook"}, {"word": "babe"}, {"word": "main"}, {"word": "woods"}, {"word": "protecting"}, {"word": "jury"}, {"word": "Harley"}, {"word": "national"}, {"word": "brave"}, {"word": "storm"}, {"word": "large"}, {"word": "prince"}, {"word": "jack's"}, {"word": "interview"}, {"word": "Daniel"}, {"word": "roger"}, {"word": "football"}, {"word": "fingers"}, {"word": "murdered"}, {"word": "Stan"}, {"word": "sexy"}, {"word": "Julia"}, {"word": "explanation"}, {"word": "da"}, {"word": "process"}, {"word": "picking"}, {"word": "based"}, {"word": "style"}, {"word": "stone"}, {"word": "pieces"}, {"word": "blah"}, {"word": "assistant"}, {"word": "stronger"}, {"word": "block"}, {"word": "aah"}, {"word": "Newman"}, {"word": "bullshit"}, {"word": "pie"}, {"word": "handsome"}, {"word": "unbelievable"}, {"word": "anytime"}, {"word": "nearly"}, {"word": "Maureen"}, {"word": "shake"}, {"word": "everyone's"}, {"word": "Oakdale"}, {"word": "cars"}, {"word": "wherever"}, {"word": "serve"}, {"word": "pulling"}, {"word": "points"}, {"word": "medicine"}, {"word": "facts"}, {"word": "waited"}, {"word": "Pete"}, {"word": "lousy"}, {"word": "circumstances"}, {"word": "stage"}, {"word": "Lucas"}, {"word": "disappointed"}, {"word": "weak"}, {"word": "trusted"}, {"word": "license"}, {"word": "nothin"}, {"word": "community"}, {"word": "trey"}, {"word": "Jan"}, {"word": "trash"}, {"word": "understanding"}, {"word": "slip"}, {"word": "cab"}, {"word": "Abby"}, {"word": "sounded"}, {"word": "awake"}, {"word": "friendship"}, {"word": "stomach"}, {"word": "weapon"}, {"word": "threatened"}, {"word": "Don"}, {"word": "mystery"}, {"word": "Sean"}, {"word": "official"}, {"word": "Lee"}, {"word": "dick"}, {"word": "regular"}, {"word": "Donna"}, {"word": "river"}, {"word": "Malcolm"}, {"word": "Vegas"}, {"word": "valley"}, {"word": "understood"}, {"word": "contract"}, {"word": "bud"}, {"word": "sexual"}, {"word": "race"}, {"word": "basically"}, {"word": "switch"}, {"word": "lake"}, {"word": "frankly"}, {"word": "issues"}, {"word": "cheap"}, {"word": "lifetime"}, {"word": "deny"}, {"word": "painting"}, {"word": "ear"}, {"word": "clock"}, {"word": "baldwin"}, {"word": "weight"}, {"word": "garbage"}, {"word": "why'd"}, {"word": "tear"}, {"word": "ears"}, {"word": "dig"}, {"word": "bullet"}, {"word": "selling"}, {"word": "setting"}, {"word": "indeed"}, {"word": "gus"}, {"word": "changing"}, {"word": "singing"}, {"word": "tiny"}, {"word": "particular"}, {"word": "draw"}, {"word": "decent"}, {"word": "susan"}, {"word": "super"}, {"word": "spring"}, {"word": "santos"}, {"word": "avoid"}, {"word": "messed"}, {"word": "united"}, {"word": "filled"}, {"word": "touched"}, {"word": "score"}, {"word": "people's"}, {"word": "disappear"}, {"word": "stranger"}, {"word": "exact"}, {"word": "pills"}, {"word": "kicked"}, {"word": "harm"}, {"word": "recently"}, {"word": "ma"}, {"word": "snow"}, {"word": "fortune"}, {"word": "strike"}, {"word": "pretending"}, {"word": "raised"}, {"word": "annie"}, {"word": "slayer"}, {"word": "monkey"}, {"word": "insurance"}, {"word": "fancy"}, {"word": "sydney"}, {"word": "drove"}, {"word": "cared"}, {"word": "belongs"}, {"word": "nights"}, {"word": "shape"}, {"word": "dogs"}, {"word": "lorelai"}, {"word": "jackie"}, {"word": "base"}, {"word": "maggie"}, {"word": "lift"}, {"word": "lewis"}, {"word": "stock"}, {"word": "sonny's"}, {"word": "fashion"}, {"word": "freedom"}, {"word": "timing"}, {"word": "johnny"}, {"word": "guarantee"}, {"word": "chest"}, {"word": "bridge"}, {"word": "woke"}, {"word": "tabitha"}, {"word": "source"}, {"word": "patients"}, {"word": "theory"}, {"word": "lisa"}, {"word": "camp"}, {"word": "original"}, {"word": "juice"}, {"word": "burned"}, {"word": "access"}, {"word": "watched"}, {"word": "heading"}, {"word": "selfish"}, {"word": "oil"}, {"word": "drinks"}, {"word": "wise"}, {"word": "Morgan"}, {"word": "Ashley"}, {"word": "failed"}, {"word": "period"}, {"word": "doll"}, {"word": "committed"}, {"word": "elevator"}, {"word": "freeze"}, {"word": "noise"}, {"word": "exist"}, {"word": "science"}, {"word": "pair"}, {"word": "edge"}, {"word": "wasting"}, {"word": "sat"}, {"word": "player"}, {"word": "ceremony"}, {"word": "cartman"}, {"word": "pig"}, {"word": "uncomfortable"}, {"word": "Ted"}, {"word": "peg"}, {"word": "guns"}, {"word": "vacation"}, {"word": "staring"}, {"word": "files"}, {"word": "bike"}, {"word": "weather"}, {"word": "name's"}, {"word": "mostly"}, {"word": "stress"}, {"word": "Kristina"}, {"word": "sucks"}, {"word": "permission"}, {"word": "arrived"}, {"word": "thrown"}, {"word": "possibility"}, {"word": "faster"}, {"word": "example"}, {"word": "borrow"}, {"word": "Casey"}, {"word": "release"}, {"word": "ate"}, {"word": "notes"}, {"word": "joy"}, {"word": "hoo"}, {"word": "library"}, {"word": "junior"}, {"word": "property"}, {"word": "negative"}, {"word": "fabulous"}, {"word": "event"}, {"word": "doors"}, {"word": "screaming"}, {"word": "vision"}, {"word": "Nancy"}, {"word": "member"}, {"word": "bone"}, {"word": "battle"}, {"word": "Xander"}, {"word": "Giles"}, {"word": "safety"}, {"word": "term"}, {"word": "devil"}, {"word": "what're"}, {"word": "meal"}, {"word": "fellow"}, {"word": "asshole"}, {"word": "apology"}, {"word": "anger"}, {"word": "honeymoon"}, {"word": "wet"}, {"word": "bail"}, {"word": "parking"}, {"word": "fucked"}, {"word": "non"}, {"word": "hung"}, {"word": "protection"}, {"word": "manager"}, {"word": "fixed"}, {"word": "families"}, {"word": "dawn"}, {"word": "sports"}, {"word": "Chinese"}, {"word": "campaign"}, {"word": "map"}, {"word": "wash"}, {"word": "stolen"}, {"word": "sensitive"}, {"word": "stealing"}, {"word": "photo"}, {"word": "chose"}, {"word": "Russell"}, {"word": "lets"}, {"word": "comfort"}, {"word": "worrying"}, {"word": "whom"}, {"word": "pocket"}, {"word": "Mateo"}, {"word": "bleeding"}, {"word": "students"}, {"word": "shoulder"}, {"word": "ignore"}, {"word": "fourth"}, {"word": "neighborhood"}, {"word": "FBI"}, {"word": "talent"}, {"word": "Spaulding"}, {"word": "Carmen"}, {"word": "tied"}, {"word": "garage"}, {"word": "dies"}, {"word": "demons"}, {"word": "travel"}, {"word": "Diana"}, {"word": "success"}, {"word": "dumped"}, {"word": "witches"}, {"word": "training"}, {"word": "rude"}, {"word": "crack"}, {"word": "model"}, {"word": "bothering"}, {"word": "radar"}, {"word": "grew"}, {"word": "willow"}, {"word": "remain"}, {"word": "soft"}, {"word": "meantime"}, {"word": "gimme"}, {"word": "connected"}, {"word": "chase"}, {"word": "kinds"}, {"word": "cast"}, {"word": "cancer"}, {"word": "Abe"}, {"word": "v"}, {"word": "sky"}, {"word": "likely"}, {"word": "Laurence"}, {"word": "fate"}, {"word": "buried"}, {"word": "hug"}, {"word": "brother's"}, {"word": "driver"}, {"word": "concentrate"}, {"word": "throat"}, {"word": "prom"}, {"word": "messages"}, {"word": "east"}, {"word": "unit"}, {"word": "intend"}, {"word": "Hayward"}, {"word": "Dan"}, {"word": "crew"}, {"word": "ashamed"}, {"word": "somethin"}, {"word": "midnight"}, {"word": "manage"}, {"word": "guilt"}, {"word": "weapons"}, {"word": "terms"}, {"word": "interrupt"}, {"word": "guts"}, {"word": "tongue"}, {"word": "distance"}, {"word": "conference"}, {"word": "treatment"}, {"word": "shoe"}, {"word": "Kane"}, {"word": "basement"}, {"word": "Alexandra"}, {"word": "sentence"}, {"word": "purse"}, {"word": "Hilda"}, {"word": "glasses"}, {"word": "cabin"}, {"word": "universe"}, {"word": "towards"}, {"word": "repeat"}, {"word": "mirror"}, {"word": "wound"}, {"word": "Travers"}, {"word": "Matthew"}, {"word": "tall"}, {"word": "reaction"}, {"word": "odd"}, {"word": "engagement"}, {"word": "therapy"}, {"word": "letters"}, {"word": "emotional"}, {"word": "runs"}, {"word": "magazine"}, {"word": "jeez"}, {"word": "decisions"}, {"word": "soup"}, {"word": "daughter's"}, {"word": "thrilled"}, {"word": "Buchanan"}, {"word": "society"}, {"word": "managed"}, {"word": "Dixie"}, {"word": "sue"}, {"word": "stake"}, {"word": "rex"}, {"word": "chef"}, {"word": "moves"}, {"word": "awesome"}, {"word": "genius"}, {"word": "extremely"}, {"word": "entirely"}, {"word": "tory"}, {"word": "nasty"}, {"word": "moments"}, {"word": "expensive"}, {"word": "counting"}, {"word": "shots"}, {"word": "kidnapped"}, {"word": "square"}, {"word": "Seattle"}, {"word": "son's"}, {"word": "London"}, {"word": "cleaning"}, {"word": "shift"}, {"word": "plate"}, {"word": "Zack"}, {"word": "impressed"}, {"word": "smells"}, {"word": "trapped"}, {"word": "male"}, {"word": "tour"}, {"word": "Aidan"}, {"word": "knocked"}, {"word": "charming"}, {"word": "attractive"}, {"word": "argue"}, {"word": "Sunday"}, {"word": "puts"}, {"word": "whip"}, {"word": "language"}, {"word": "heck"}, {"word": "embarrassed"}, {"word": "settled"}, {"word": "package"}, {"word": "laid"}, {"word": "animals"}, {"word": "hitting"}, {"word": "disease"}, {"word": "bust"}, {"word": "stairs"}, {"word": "Lizzie"}, {"word": "alarm"}, {"word": "pure"}, {"word": "nail"}, {"word": "nerve"}, {"word": "incredibly"}, {"word": "hill"}, {"word": "walks"}, {"word": "lane"}, {"word": "dirt"}, {"word": "bond"}, {"word": "stamp"}, {"word": "sister's"}, {"word": "becoming"}, {"word": "terribly"}, {"word": "friendly"}, {"word": "easily"}, {"word": "damned"}, {"word": "jobs"}, {"word": "suffering"}, {"word": "disgusting"}, {"word": "washington"}, {"word": "stopping"}, {"word": "deliver"}, {"word": "riding"}, {"word": "helps"}, {"word": "federal"}, {"word": "disaster"}, {"word": "bars"}, {"word": "DNA"}, {"word": "crossed"}, {"word": "rate"}, {"word": "create"}, {"word": "trap"}, {"word": "claim"}, {"word": "Christine"}, {"word": "California"}, {"word": "talks"}, {"word": "eggs"}, {"word": "effect"}, {"word": "chick"}, {"word": "turkey"}, {"word": "threatening"}, {"word": "spoken"}, {"word": "snake"}, {"word": "introduce"}, {"word": "rescue"}, {"word": "confession"}, {"word": "embarrassing"}, {"word": "bags"}, {"word": "lover"}, {"word": "impression"}, {"word": "gate"}, {"word": "Kim"}, {"word": "fantasy"}, {"word": "year's"}, {"word": "reputation"}, {"word": "balls"}, {"word": "attacked"}, {"word": "among"}, {"word": "lt"}, {"word": "knowledge"}, {"word": "presents"}, {"word": "inn"}, {"word": "Europe"}, {"word": "chat"}, {"word": "suffer"}, {"word": "bryant"}, {"word": "argument"}, {"word": "talkin"}, {"word": "crowd"}, {"word": "Montgomery"}, {"word": "homework"}, {"word": "fought"}, {"word": "coincidence"}, {"word": "cancel"}, {"word": "accepted"}, {"word": "rip"}, {"word": "pride"}, {"word": "solve"}, {"word": "hopefully"}, {"word": "Walter"}, {"word": "pounds"}, {"word": "pine"}, {"word": "mate"}, {"word": "illegal"}, {"word": "generous"}, {"word": "tommy"}, {"word": "streets"}, {"word": "matt"}, {"word": "director"}, {"word": "glen"}, {"word": "con"}, {"word": "separate"}, {"word": "outfit"}, {"word": "maid"}, {"word": "bath"}, {"word": "punch"}, {"word": "phil"}, {"word": "mayor"}, {"word": "helen"}, {"word": "freaked"}, {"word": "begging"}, {"word": "recall"}, {"word": "enjoying"}, {"word": "bug"}, {"word": "woman's"}, {"word": "prepare"}, {"word": "parts"}, {"word": "wheel"}, {"word": "signal"}, {"word": "nikki"}, {"word": "direction"}, {"word": "defend"}, {"word": "signs"}, {"word": "painful"}, {"word": "caroline"}, {"word": "yourselves"}, {"word": "walls"}, {"word": "rat"}, {"word": "maris"}, {"word": "amount"}, {"word": "that'd"}, {"word": "suspicious"}, {"word": "hearts"}, {"word": "flat"}, {"word": "cooking"}, {"word": "button"}, {"word": "warned"}, {"word": "sixty"}, {"word": "pity"}, {"word": "parties"}, {"word": "crisis"}, {"word": "rae"}, {"word": "coach"}, {"word": "abbott"}, {"word": "row"}, {"word": "baseball"}, {"word": "yelling"}, {"word": "leads"}, {"word": "awhile"}, {"word": "pen"}, {"word": "confidence"}, {"word": "offering"}, {"word": "falls"}, {"word": "carter"}, {"word": "image"}, {"word": "farm"}, {"word": "pleased"}, {"word": "panic"}, {"word": "monday"}, {"word": "hers"}, {"word": "gettin"}, {"word": "smith"}, {"word": "role"}, {"word": "refuse"}, {"word": "determined"}, {"word": "jane"}, {"word": "hell's"}, {"word": "grandpa"}, {"word": "progress"}, {"word": "mexico"}, {"word": "testify"}, {"word": "passing"}, {"word": "military"}, {"word": "choices"}, {"word": "artist"}, {"word": "william"}, {"word": "wh"}, {"word": "uhh"}, {"word": "gym"}, {"word": "cruel"}, {"word": "wings"}, {"word": "traffic"}, {"word": "pink"}, {"word": "bodies"}, {"word": "mental"}, {"word": "gentleman"}, {"word": "coma"}, {"word": "poison"}, {"word": "cutting"}, {"word": "proteus"}, {"word": "guests"}, {"word": "girl's"}, {"word": "expert"}, {"word": "bull"}, {"word": "benefit"}, {"word": "bell"}, {"word": "faces"}, {"word": "cases"}, {"word": "mimi"}, {"word": "ghost"}, {"word": "led"}, {"word": "jumped"}, {"word": "Audrey"}, {"word": "toilet"}, {"word": "secretary"}, {"word": "sneak"}, {"word": "q"}, {"word": "mix"}, {"word": "marty"}, {"word": "Greta"}, {"word": "firm"}, {"word": "Halloween"}, {"word": "Barry"}, {"word": "agreement"}, {"word": "privacy"}, {"word": "dates"}, {"word": "anniversary"}, {"word": "smoking"}, {"word": "reminds"}, {"word": "pot"}, {"word": "created"}, {"word": "Wesley"}, {"word": "twins"}, {"word": "swing"}, {"word": "successful"}, {"word": "season"}, {"word": "scream"}, {"word": "considered"}, {"word": "solid"}, {"word": "options"}, {"word": "flash"}, {"word": "commitment"}, {"word": "senior"}, {"word": "ill"}, {"word": "else's"}, {"word": "crush"}, {"word": "ambulance"}, {"word": "wallet"}, {"word": "Thomas"}, {"word": "Logan"}, {"word": "discovered"}, {"word": "officially"}, {"word": "gang"}, {"word": "til"}, {"word": "rise"}, {"word": "reached"}, {"word": "eleven"}, {"word": "option"}, {"word": "laundry"}, {"word": "former"}, {"word": "assure"}, {"word": "stays"}, {"word": "skip"}, {"word": "hunt"}, {"word": "fail"}, {"word": "accused"}, {"word": "wide"}, {"word": "Robert"}, {"word": "challenge"}, {"word": "Snyder"}, {"word": "popular"}, {"word": "learning"}, {"word": "discussion"}, {"word": "clinic"}, {"word": "plant"}, {"word": "exchange"}, {"word": "betrayed"}, {"word": "bro"}, {"word": "sticking"}, {"word": "university"}, {"word": "target"}, {"word": "members"}, {"word": "lower"}, {"word": "bored"}, {"word": "mansion"}, {"word": "soda"}, {"word": "silver"}, {"word": "sheriff"}, {"word": "suite"}, {"word": "handled"}, {"word": "busted"}, {"word": "senator"}, {"word": "Harold"}, {"word": "load"}, {"word": "happier"}, {"word": "younger"}, {"word": "studying"}, {"word": "romance"}, {"word": "procedure"}, {"word": "ocean"}, {"word": "section"}, {"word": "Fred"}, {"word": "winter"}, {"word": "sec"}, {"word": "commit"}, {"word": "bones"}, {"word": "assignment"}, {"word": "suicide"}, {"word": "spread"}, {"word": "Quinn"}, {"word": "minds"}, {"word": "fishing"}, {"word": "swim"}, {"word": "ending"}, {"word": "bat"}, {"word": "yell"}, {"word": "llanview"}, {"word": "league"}, {"word": "chasing"}, {"word": "seats"}, {"word": "proper"}, {"word": "holiday"}, {"word": "command"}, {"word": "believes"}, {"word": "humor"}, {"word": "hopes"}, {"word": "fifth"}, {"word": "winning"}, {"word": "solution"}, {"word": "leader"}, {"word": "yellow"}, {"word": "Theresa's"}, {"word": "sharp"}, {"word": "sale"}, {"word": "Randy"}, {"word": "lawyers"}, {"word": "giant"}, {"word": "nor"}, {"word": "material"}, {"word": "latest"}, {"word": "ash"}, {"word": "highly"}, {"word": "escaped"}, {"word": "audience"}, {"word": "winner"}, {"word": "parent"}, {"word": "burns"}, {"word": "tricks"}, {"word": "insist"}, {"word": "dropping"}, {"word": "cheer"}, {"word": "medication"}, {"word": "higher"}, {"word": "flesh"}, {"word": "district"}, {"word": "wood"}, {"word": "routine"}, {"word": "Zelda"}, {"word": "cookies"}, {"word": "century"}, {"word": "shared"}, {"word": "sandwich"}, {"word": "psycho"}, {"word": "handed"}, {"word": "false"}, {"word": "beating"}, {"word": "appear"}, {"word": "adult"}, {"word": "warrant"}, {"word": "spike"}, {"word": "garden"}, {"word": "family's"}, {"word": "awfully"}, {"word": "odds"}, {"word": "article"}, {"word": "treating"}, {"word": "thin"}, {"word": "suggesting"}, {"word": "Palmer"}, {"word": "fever"}, {"word": "female"}, {"word": "sweat"}, {"word": "silent"}, {"word": "specific"}, {"word": "clever"}, {"word": "sweater"}, {"word": "request"}, {"word": "prize"}, {"word": "mall"}, {"word": "tries"}, {"word": "mile"}, {"word": "manning"}, {"word": "fully"}, {"word": "estate"}, {"word": "diamond"}, {"word": "union"}, {"word": "sharing"}, {"word": "Jamie"}, {"word": "assuming"}, {"word": "judgment"}, {"word": "goodnight"}, {"word": "divorced"}, {"word": "quality"}, {"word": "despite"}, {"word": "Colby"}, {"word": "surely"}, {"word": "steps"}, {"word": "jet"}, {"word": "confess"}, {"word": "Bart"}, {"word": "mountain"}, {"word": "math"}, {"word": "listened"}, {"word": "comin"}, {"word": "answered"}, {"word": "vulnerable"}, {"word": "Boston"}, {"word": "bless"}, {"word": "dreaming"}, {"word": "rooms"}, {"word": "Claire"}, {"word": "chip"}, {"word": "zero"}, {"word": "potential"}, {"word": "pissed"}, {"word": "Nate"}, {"word": "kills"}, {"word": "grant"}, {"word": "wolf"}, {"word": "tears"}, {"word": "knees"}, {"word": "chill"}, {"word": "Carly's"}, {"word": "blonde"}, {"word": "brains"}, {"word": "agency"}, {"word": "Harvard"}, {"word": "degree"}, {"word": "unusual"}, {"word": "wife's"}, {"word": "joint"}, {"word": "rob"}, {"word": "packed"}, {"word": "Mel"}, {"word": "dreamed"}, {"word": "cure"}, {"word": "covering"}, {"word": "newspaper"}, {"word": "lookin"}, {"word": "coast"}, {"word": "grave"}, {"word": "egg"}, {"word": "direct"}, {"word": "cheating"}, {"word": "breaks"}, {"word": "quarter"}, {"word": "orange"}, {"word": "mixed"}, {"word": "locker"}, {"word": "husband's"}, {"word": "gifts"}, {"word": "brand"}, {"word": "awkward"}, {"word": "toy"}, {"word": "Thursday"}, {"word": "rare"}, {"word": "policy"}, {"word": "pilar"}, {"word": "kid's"}, {"word": "joking"}, {"word": "competition"}, {"word": "classes"}, {"word": "assumed"}, {"word": "reasonable"}, {"word": "dozen"}, {"word": "curse"}, {"word": "quartermaine"}, {"word": "millions"}, {"word": "dessert"}, {"word": "rolling"}, {"word": "detail"}, {"word": "alien"}, {"word": "served"}, {"word": "delicious"}, {"word": "closing"}, {"word": "vampires"}, {"word": "released"}, {"word": "Mackenzie"}, {"word": "ancient"}, {"word": "wore"}, {"word": "value"}, {"word": "tail"}, {"word": "site"}, {"word": "secure"}, {"word": "salad"}, {"word": "murderer"}, {"word": "Margaret"}, {"word": "hits"}, {"word": "toward"}, {"word": "spit"}, {"word": "screen"}, {"word": "pilot"}, {"word": "penny"}, {"word": "offense"}, {"word": "dust"}, {"word": "conscience"}, {"word": "Carl"}, {"word": "bread"}, {"word": "answering"}, {"word": "admitted"}, {"word": "lame"}, {"word": "invitation"}, {"word": "hidden"}, {"word": "grief"}, {"word": "smiling"}, {"word": "path"}, {"word": "homer"}, {"word": "destiny"}, {"word": "del"}, {"word": "stands"}, {"word": "bowl"}, {"word": "pregnancy"}, {"word": "Laurie"}, {"word": "Hollywood"}, {"word": "co"}, {"word": "prisoner"}, {"word": "delivery"}, {"word": "Jenny"}, {"word": "guards"}, {"word": "desire"}, {"word": "virus"}, {"word": "shrink"}, {"word": "influence"}, {"word": "freezing"}, {"word": "concert"}, {"word": "wreck"}, {"word": "partners"}, {"word": "Massimo"}, {"word": "chain"}, {"word": "birds"}, {"word": "walker"}, {"word": "life's"}, {"word": "wire"}, {"word": "technically"}, {"word": "presence"}, {"word": "blown"}, {"word": "anxious"}, {"word": "cave"}, {"word": "version"}, {"word": "mickey"}, {"word": "holidays"}, {"word": "cleared"}, {"word": "wishes"}, {"word": "survived"}, {"word": "caring"}, {"word": "candles"}, {"word": "bound"}, {"word": "related"}, {"word": "Gabrielle"}, {"word": "charm"}, {"word": "apple"}, {"word": "yup"}, {"word": "Texas"}, {"word": "pulse"}, {"word": "jumping"}, {"word": "jokes"}, {"word": "frame"}, {"word": "boom"}, {"word": "vice"}, {"word": "performance"}, {"word": "occasion"}, {"word": "silence"}, {"word": "opera"}, {"word": "opal"}, {"word": "nonsense"}, {"word": "Julie"}, {"word": "frightened"}, {"word": "downtown"}, {"word": "Americans"}, {"word": "Joshua"}, {"word": "internet"}, {"word": "Valerie"}, {"word": "slipped"}, {"word": "Lucinda"}, {"word": "holly"}, {"word": "duck"}, {"word": "dimera"}, {"word": "blowing"}, {"word": "world's"}, {"word": "session"}, {"word": "relationships"}, {"word": "kidnapping"}, {"word": "England"}, {"word": "actual"}, {"word": "spin"}, {"word": "classic"}, {"word": "civil"}, {"word": "tool"}, {"word": "Roxy"}, {"word": "packing"}, {"word": "education"}, {"word": "blaming"}, {"word": "wrap"}, {"word": "obsessed"}, {"word": "fruit"}, {"word": "torture"}, {"word": "personality"}, {"word": "location"}, {"word": "loan"}, {"word": "effort"}, {"word": "daddy's"}, {"word": "commander"}, {"word": "trees"}, {"word": "there'll"}, {"word": "rocks"}, {"word": "owner"}, {"word": "fairy"}, {"word": "banks"}, {"word": "network"}, {"word": "per"}, {"word": "other's"}, {"word": "necessarily"}, {"word": "Louis"}, {"word": "county"}, {"word": "contest"}, {"word": "chuck"}, {"word": "seventy"}, {"word": "print"}, {"word": "motel"}, {"word": "fallen"}, {"word": "directly"}, {"word": "underwear"}, {"word": "grams"}, {"word": "exhausted"}, {"word": "believing"}, {"word": "Thorne"}, {"word": "particularly"}, {"word": "freaking"}, {"word": "carefully"}, {"word": "trace"}, {"word": "touching"}, {"word": "messing"}, {"word": "Hughes"}, {"word": "committee"}, {"word": "smooth"}, {"word": "recovery"}, {"word": "intention"}, {"word": "enter"}, {"word": "consequences"}, {"word": "belt"}, {"word": "standard"}, {"word": "sacrifice"}, {"word": "marina"}, {"word": "courage"}, {"word": "butter"}, {"word": "officers"}, {"word": "enjoyed"}, {"word": "ad"}, {"word": "lack"}, {"word": "buck"}, {"word": "attracted"}, {"word": "appears"}, {"word": "Spencer"}, {"word": "bay"}, {"word": "yard"}, {"word": "returned"}, {"word": "remove"}, {"word": "nut"}, {"word": "carried"}, {"word": "today's"}, {"word": "testimony"}, {"word": "intense"}, {"word": "granted"}, {"word": "Alice"}, {"word": "violence"}, {"word": "Peggy"}, {"word": "heal"}, {"word": "defending"}, {"word": "attempt"}, {"word": "unfair"}, {"word": "relieved"}, {"word": "political"}, {"word": "loyal"}, {"word": "approach"}, {"word": "slowly"}, {"word": "plays"}, {"word": "normally"}, {"word": "buzz"}, {"word": "alcohol"}, {"word": "actor"}, {"word": "surprises"}, {"word": "psychiatrist"}, {"word": "pre"}, {"word": "plain"}, {"word": "attic"}, {"word": "who'd"}, {"word": "uniform"}, {"word": "terrified"}, {"word": "sons"}, {"word": "pet"}, {"word": "Kristen"}, {"word": "cleaned"}, {"word": "Zach"}, {"word": "threaten"}, {"word": "teaching"}, {"word": "mum"}, {"word": "motion"}, {"word": "fella"}, {"word": "enemies"}, {"word": "desert"}, {"word": "collection"}, {"word": "Roxanne"}, {"word": "incident"}, {"word": "failure"}, {"word": "satisfied"}, {"word": "imagination"}, {"word": "hooked"}, {"word": "headache"}, {"word": "forgetting"}, {"word": "counselor"}, {"word": "Andie"}, {"word": "acted"}, {"word": "opposite"}, {"word": "highest"}, {"word": "gross"}, {"word": "golden"}, {"word": "equipment"}, {"word": "badge"}, {"word": "tennis"}, {"word": "Italian"}, {"word": "visiting"}, {"word": "Tricia"}, {"word": "studio"}, {"word": "naturally"}, {"word": "frozen"}, {"word": "commissioner"}, {"word": "sakes"}, {"word": "Lorelei"}, {"word": "labor"}, {"word": "glory"}, {"word": "appropriate"}, {"word": "Africa"}, {"word": "trunk"}, {"word": "armed"}, {"word": "twisted"}, {"word": "thousands"}, {"word": "received"}, {"word": "dunno"}, {"word": "costume"}, {"word": "temporary"}, {"word": "sixteen"}, {"word": "impressive"}, {"word": "zone"}, {"word": "kitty"}, {"word": "kicking"}, {"word": "junk"}, {"word": "hon"}, {"word": "grabbed"}, {"word": "France"}, {"word": "unlike"}, {"word": "understands"}, {"word": "mercy"}, {"word": "describe"}, {"word": "Wayne"}, {"word": "priest"}, {"word": "Cordelia"}, {"word": "clients"}, {"word": "cable"}, {"word": "owns"}, {"word": "affect"}, {"word": "witnesses"}, {"word": "starving"}, {"word": "Robbie"}, {"word": "instincts"}, {"word": "happily"}, {"word": "discussing"}, {"word": "deserved"}, {"word": "strangers"}, {"word": "leading"}, {"word": "intelligence"}, {"word": "host"}, {"word": "authority"}, {"word": "surveillance"}, {"word": "cow"}, {"word": "commercial"}, {"word": "admire"}, {"word": "Williams"}, {"word": "Tuesday"}, {"word": "shadow"}, {"word": "questioning"}, {"word": "fund"}, {"word": "dragged"}, {"word": "barn"}, {"word": "object"}, {"word": "Doug"}, {"word": "deeply"}, {"word": "amp"}, {"word": "wrapped"}, {"word": "wasted"}, {"word": "Vega"}, {"word": "tense"}, {"word": "sport"}, {"word": "route"}, {"word": "reports"}, {"word": "Reese"}, {"word": "plastic"}, {"word": "hoped"}, {"word": "fellas"}, {"word": "election"}, {"word": "roommate"}, {"word": "pierce"}, {"word": "mortal"}, {"word": "fascinating"}, {"word": "chosen"}, {"word": "stops"}, {"word": "shown"}, {"word": "arranged"}, {"word": "Arnold"}, {"word": "abandoned"}, {"word": "sides"}, {"word": "delivered"}, {"word": "china"}, {"word": "becomes"}, {"word": "arrangements"}, {"word": "agenda"}, {"word": "Linda"}, {"word": "hunting"}, {"word": "began"}, {"word": "theater"}, {"word": "series"}, {"word": "literally"}, {"word": "propose"}, {"word": "Howard"}, {"word": "honesty"}, {"word": "basketball"}, {"word": "underneath"}, {"word": "forces"}, {"word": "soldier"}, {"word": "services"}, {"word": "sauce"}, {"word": "review"}, {"word": "promises"}, {"word": "Oz"}, {"word": "lecture"}, {"word": "Greg"}, {"word": "eighty"}, {"word": "brandy"}, {"word": "bills"}, {"word": "Bauer"}, {"word": "windows"}, {"word": "torn"}, {"word": "shocked"}, {"word": "relief"}, {"word": "Nathan"}, {"word": "Jones"}, {"word": "horses"}, {"word": "golf"}, {"word": "Florida"}, {"word": "explained"}, {"word": "counter"}, {"word": "Niki"}, {"word": "Lauren"}, {"word": "design"}, {"word": "circle"}, {"word": "victims"}, {"word": "transfer"}, {"word": "Stanley"}, {"word": "response"}, {"word": "channel"}, {"word": "backup"}, {"word": "identity"}, {"word": "differently"}, {"word": "campus"}, {"word": "spy"}, {"word": "ninety"}, {"word": "interests"}, {"word": "guide"}, {"word": "Emma"}, {"word": "elliot"}, {"word": "deck"}, {"word": "biological"}, {"word": "Vince"}, {"word": "SD"}, {"word": "pheebs"}, {"word": "minor"}, {"word": "ease"}, {"word": "creep"}, {"word": "Will's"}, {"word": "waitress"}, {"word": "skills"}, {"word": "Bobbie"}, {"word": "telephone"}, {"word": "photos"}, {"word": "Keith"}, {"word": "Catalina"}, {"word": "ripped"}, {"word": "raising"}, {"word": "scratch"}, {"word": "rings"}, {"word": "prints"}, {"word": "flower"}, {"word": "wave"}, {"word": "thee"}, {"word": "arguing"}, {"word": "royal"}, {"word": "laws"}, {"word": "figures"}, {"word": "Ephram"}, {"word": "Ellison"}, {"word": "asks"}, {"word": "writer"}, {"word": "reception"}, {"word": "pin"}, {"word": "oops"}, {"word": "gt"}, {"word": "diner"}, {"word": "annoying"}, {"word": "agents"}, {"word": "taggert"}, {"word": "goal"}, {"word": "council"}, {"word": "mass"}, {"word": "ability"}, {"word": "sergeant"}, {"word": "Julian's"}, {"word": "international"}, {"word": "id"}, {"word": "Gina"}, {"word": "gig"}, {"word": "Davidson"}, {"word": "blast"}, {"word": "basic"}, {"word": "wing"}, {"word": "tradition"}, {"word": "towel"}, {"word": "Steven"}, {"word": "Jenkins"}, {"word": "earned"}, {"word": "clown"}, {"word": "rub"}, {"word": "president's"}, {"word": "habit"}, {"word": "customers"}, {"word": "creature"}, {"word": "counts"}, {"word": "Bermuda"}, {"word": "actions"}, {"word": "snap"}, {"word": "Roman"}, {"word": "react"}, {"word": "prime"}, {"word": "paranoid"}, {"word": "pace"}, {"word": "wha"}, {"word": "Romeo"}, {"word": "handling"}, {"word": "eaten"}, {"word": "dahlia"}, {"word": "therapist"}, {"word": "comment"}, {"word": "charged"}, {"word": "tax"}, {"word": "sink"}, {"word": "reporter"}, {"word": "nurses"}, {"word": "beats"}, {"word": "priority"}, {"word": "Johnson"}, {"word": "interrupting"}, {"word": "gain"}, {"word": "fed"}, {"word": "Bennett"}, {"word": "warehouse"}, {"word": "virgin"}, {"word": "shy"}, {"word": "pattern"}, {"word": "loyalty"}, {"word": "inspector"}, {"word": "events"}, {"word": "candle"}, {"word": "pleasant"}, {"word": "media"}, {"word": "excuses"}, {"word": "duke"}, {"word": "castle"}, {"word": "threats"}, {"word": "Samantha"}, {"word": "permanent"}, {"word": "guessing"}, {"word": "financial"}, {"word": "demand"}, {"word": "Darla"}, {"word": "basket"}, {"word": "assault"}, {"word": "Ali"}, {"word": "tend"}, {"word": "praying"}, {"word": "motive"}, {"word": "los"}, {"word": "unconscious"}, {"word": "trained"}, {"word": "Stuart"}, {"word": "Ralph"}, {"word": "museum"}, {"word": "Betty"}, {"word": "alley"}, {"word": "tracks"}, {"word": "swimming"}, {"word": "range"}, {"word": "nap"}, {"word": "mysterious"}, {"word": "unhappy"}, {"word": "tone"}, {"word": "switched"}, {"word": "Rappaport"}, {"word": "Nina"}, {"word": "liberty"}, {"word": "bang"}, {"word": "award"}, {"word": "Sookie"}, {"word": "neighbor"}, {"word": "loaded"}, {"word": "gut"}, {"word": "Cooper"}, {"word": "childhood"}, {"word": "causing"}, {"word": "swore"}, {"word": "sample"}, {"word": "piss"}, {"word": "hundreds"}, {"word": "balance"}, {"word": "background"}, {"word": "toss"}, {"word": "mob"}, {"word": "misery"}, {"word": "central"}, {"word": "boots"}, {"word": "Valentine's"}, {"word": "thief"}, {"word": "squeeze"}, {"word": "potter"}, {"word": "lobby"}, {"word": "hah"}, {"word": "goa'uld"}, {"word": "geez"}, {"word": "exercise"}, {"word": "ego"}, {"word": "drama"}, {"word": "Al's"}, {"word": "patience"}, {"word": "noble"}, {"word": "Katherine"}, {"word": "Isabel"}, {"word": "indian"}, {"word": "forth"}, {"word": "facing"}, {"word": "engine"}, {"word": "booked"}, {"word": "boo"}, {"word": "un"}, {"word": "songs"}, {"word": "Sandburg"}, {"word": "poker"}, {"word": "eighteen"}, {"word": "d'you"}, {"word": "cookie"}, {"word": "bury"}, {"word": "perform"}, {"word": "Hayley"}, {"word": "everyday"}, {"word": "digging"}, {"word": "Davis"}, {"word": "creepy"}, {"word": "compared"}, {"word": "wondered"}, {"word": "trail"}, {"word": "saint"}, {"word": "rotten"}, {"word": "liver"}, {"word": "hmmm"}, {"word": "drawn"}, {"word": "device"}, {"word": "whore"}, {"word": "ta"}, {"word": "magical"}, {"word": "Bruce"}, {"word": "village"}, {"word": "march"}, {"word": "journey"}, {"word": "fits"}, {"word": "discussed"}, {"word": "zombie"}, {"word": "supply"}, {"word": "moral"}, {"word": "helpful"}, {"word": "attached"}, {"word": "Timmy's"}, {"word": "slut"}, {"word": "searching"}, {"word": "flew"}, {"word": "depressed"}, {"word": "aliens"}, {"word": "aisle"}, {"word": "underground"}, {"word": "pro"}, {"word": "drew"}, {"word": "daughters"}, {"word": "cris"}, {"word": "amen"}, {"word": "vows"}, {"word": "proposal"}, {"word": "pit"}, {"word": "neighbors"}, {"word": "darn"}, {"word": "clay"}, {"word": "cents"}, {"word": "arrange"}, {"word": "annulment"}, {"word": "uses"}, {"word": "useless"}, {"word": "squad"}, {"word": "represent"}, {"word": "product"}, {"word": "joined"}, {"word": "afterwards"}, {"word": "adventure"}, {"word": "resist"}, {"word": "protected"}, {"word": "net"}, {"word": "Marlena"}, {"word": "fourteen"}, {"word": "celebrating"}, {"word": "Benny"}, {"word": "piano"}, {"word": "inch"}, {"word": "flag"}, {"word": "debt"}, {"word": "darkness"}, {"word": "violent"}, {"word": "tag"}, {"word": "sand"}, {"word": "gum"}, {"word": "dammit"}, {"word": "teal'c"}, {"word": "strip"}, {"word": "Norman"}, {"word": "hip"}, {"word": "celebration"}, {"word": "below"}, {"word": "reminded"}, {"word": "palace"}, {"word": "claims"}, {"word": "tonight's"}, {"word": "replace"}, {"word": "phones"}, {"word": "paperwork"}, {"word": "mighty"}, {"word": "Lloyd"}, {"word": "emotions"}, {"word": "Andrew"}, {"word": "typical"}, {"word": "stubborn"}, {"word": "stable"}, {"word": "Sheridan's"}, {"word": "pound"}, {"word": "pillow"}, {"word": "papa"}, {"word": "mature"}, {"word": "lap"}, {"word": "designed"}, {"word": "current"}, {"word": "Canada"}, {"word": "bum"}, {"word": "tension"}, {"word": "tank"}, {"word": "suffered"}, {"word": "stroke"}, {"word": "steady"}, {"word": "provide"}, {"word": "overnight"}, {"word": "meanwhile"}, {"word": "chips"}, {"word": "beef"}, {"word": "wins"}, {"word": "suits"}, {"word": "carol"}, {"word": "boxes"}, {"word": "salt"}, {"word": "el"}, {"word": "Cassadine"}, {"word": "express"}, {"word": "collect"}, {"word": "boy's"}, {"word": "ba"}, {"word": "tragedy"}, {"word": "therefore"}, {"word": "spoil"}, {"word": "Libby"}, {"word": "realm"}, {"word": "profile"}, {"word": "degrees"}, {"word": "wipe"}, {"word": "Wilson"}, {"word": "surgeon"}, {"word": "stretch"}, {"word": "stepped"}, {"word": "nephew"}, {"word": "neat"}, {"word": "limo"}, {"word": "fox"}, {"word": "confident"}, {"word": "anti"}, {"word": "victory"}, {"word": "perspective"}, {"word": "designer"}, {"word": "climb"}, {"word": "angels"}, {"word": "title"}, {"word": "suggested"}, {"word": "punishment"}, {"word": "finest"}, {"word": "Ethan's"}, {"word": "Stefan"}, {"word": "Springfield"}, {"word": "occurred"}, {"word": "hint"}, {"word": "furniture"}, {"word": "blanket"}, {"word": "twist"}, {"word": "trigger"}, {"word": "surrounded"}, {"word": "surface"}, {"word": "proceed"}, {"word": "lip"}, {"word": "jersey"}, {"word": "fries"}, {"word": "worries"}, {"word": "refused"}, {"word": "niece"}, {"word": "handy"}, {"word": "gloves"}, {"word": "soap"}, {"word": "signature"}, {"word": "disappoint"}, {"word": "crawl"}, {"word": "convicted"}, {"word": "zoo"}, {"word": "result"}, {"word": "pages"}, {"word": "lit"}, {"word": "flip"}, {"word": "counsel"}, {"word": "cheers"}, {"word": "doubts"}, {"word": "crimes"}, {"word": "accusing"}, {"word": "when's"}, {"word": "shaking"}, {"word": "remembering"}, {"word": "phase"}, {"word": "kit"}, {"word": "hallway"}, {"word": "halfway"}, {"word": "bothered"}, {"word": "useful"}, {"word": "Sid"}, {"word": "popcorn"}, {"word": "makeup"}, {"word": "madam"}, {"word": "Louise"}, {"word": "Jean"}, {"word": "gather"}, {"word": "cowboy"}, {"word": "concerns"}, {"word": "CIA"}, {"word": "cameras"}, {"word": "blackmail"}, {"word": "Winnie"}, {"word": "symptoms"}, {"word": "rope"}, {"word": "Patrick"}, {"word": "ordinary"}, {"word": "imagined"}, {"word": "concept"}, {"word": "cigarette"}, {"word": "barb"}, {"word": "supportive"}, {"word": "memorial"}, {"word": "Japanese"}, {"word": "explosion"}, {"word": "Coleman"}, {"word": "Bundy"}, {"word": "yay"}, {"word": "woo"}, {"word": "trauma"}, {"word": "Russian"}, {"word": "ouch"}, {"word": "Leo's"}, {"word": "furious"}, {"word": "cheat"}, {"word": "avoiding"}, {"word": "whew"}, {"word": "thick"}, {"word": "oooh"}, {"word": "boarding"}, {"word": "approve"}, {"word": "urgent"}, {"word": "shhh"}, {"word": "misunderstanding"}, {"word": "minister"}, {"word": "Ellen"}, {"word": "drawer"}, {"word": "sin"}, {"word": "phony"}, {"word": "joining"}, {"word": "jam"}, {"word": "interfere"}, {"word": "governor"}, {"word": "Eden"}, {"word": "chapter"}, {"word": "catching"}, {"word": "bargain"}, {"word": "warren"}, {"word": "tragic"}, {"word": "schools"}, {"word": "respond"}, {"word": "punish"}, {"word": "penthouse"}, {"word": "hop"}, {"word": "angle"}, {"word": "thou"}, {"word": "sherry"}, {"word": "remains"}, {"word": "rach"}, {"word": "ohhh"}, {"word": "insult"}, {"word": "doctor's"}, {"word": "bugs"}, {"word": "beside"}, {"word": "begged"}, {"word": "absolute"}, {"word": "strictly"}, {"word": "Stefano"}, {"word": "socks"}, {"word": "senses"}, {"word": "British"}, {"word": "ups"}, {"word": "sneaking"}, {"word": "Sheila"}, {"word": "yah"}, {"word": "worthy"}, {"word": "Val"}, {"word": "serving"}, {"word": "reward"}, {"word": "polite"}, {"word": "checks"}, {"word": "tale"}, {"word": "physically"}, {"word": "instructions"}, {"word": "fooled"}, {"word": "blows"}, {"word": "tabby"}, {"word": "internal"}, {"word": "bitter"}, {"word": "adorable"}, {"word": "y'all"}, {"word": "tested"}, {"word": "suggestion"}, {"word": "string"}, {"word": "mouse"}, {"word": "marks"}, {"word": "jewelry"}, {"word": "debate"}, {"word": "com"}, {"word": "alike"}, {"word": "pitch"}, {"word": "Lou"}, {"word": "jacks"}, {"word": "fax"}, {"word": "distracted"}, {"word": "shelter"}, {"word": "lovers"}, {"word": "lessons"}, {"word": "hart"}, {"word": "goose"}, {"word": "foreign"}, {"word": "escort"}, {"word": "average"}, {"word": "twin"}, {"word": "testing"}, {"word": "friend's"}, {"word": "damnit"}, {"word": "constable"}, {"word": "circus"}, {"word": "Berg"}, {"word": "audition"}, {"word": "tune"}, {"word": "shoulders"}, {"word": "mud"}, {"word": "mask"}, {"word": "helpless"}, {"word": "feeding"}, {"word": "explains"}, {"word": "dated"}, {"word": "sucked"}, {"word": "robbery"}, {"word": "objection"}, {"word": "kirk"}, {"word": "Kennedy"}, {"word": "Collins"}, {"word": "Christina"}, {"word": "behave"}, {"word": "valuable"}, {"word": "Simpson"}, {"word": "shadows"}, {"word": "Marcy"}, {"word": "Gary"}, {"word": "creative"}, {"word": "courtroom"}, {"word": "confusing"}, {"word": "beast"}, {"word": "tub"}, {"word": "talented"}, {"word": "struck"}, {"word": "smarter"}, {"word": "mistaken"}, {"word": "Italy"}, {"word": "customer"}, {"word": "bizarre"}, {"word": "scaring"}, {"word": "punk"}, {"word": "motherfucker"}, {"word": "holds"}, {"word": "focused"}, {"word": "Angeles"}, {"word": "alert"}, {"word": "activity"}, {"word": "vecchio"}, {"word": "sticks"}, {"word": "singer"}, {"word": "reverend"}, {"word": "highway"}, {"word": "Francisco"}, {"word": "foolish"}, {"word": "compliment"}, {"word": "blessed"}, {"word": "bastards"}, {"word": "attend"}, {"word": "scheme"}, {"word": "Joanna"}, {"word": "Marissa"}, {"word": "Canadian"}, {"word": "aid"}, {"word": "worker"}, {"word": "wheelchair"}, {"word": "protective"}, {"word": "poetry"}, {"word": "gentle"}, {"word": "script"}, {"word": "reverse"}, {"word": "picnic"}, {"word": "knee"}, {"word": "intended"}, {"word": "construction"}, {"word": "cage"}, {"word": "wives"}, {"word": "Wednesday"}, {"word": "voices"}, {"word": "toes"}, {"word": "stink"}, {"word": "scares"}, {"word": "pour"}, {"word": "effects"}, {"word": "cheated"}, {"word": "tower"}, {"word": "time's"}, {"word": "slide"}, {"word": "ruining"}, {"word": "recent"}, {"word": "jewish"}, {"word": "Jesse"}, {"word": "filling"}, {"word": "exit"}, {"word": "cruise"}, {"word": "cottage"}, {"word": "corporate"}, {"word": "cats"}, {"word": "upside"}, {"word": "supplies"}, {"word": "proves"}, {"word": "parked"}, {"word": "Jo"}, {"word": "instance"}, {"word": "grounds"}, {"word": "German"}, {"word": "diary"}, {"word": "complaining"}, {"word": "basis"}, {"word": "wounded"}, {"word": "thing's"}, {"word": "politics"}, {"word": "Hawaii"}, {"word": "confessed"}, {"word": "wicked"}, {"word": "pipe"}, {"word": "merely"}, {"word": "massage"}, {"word": "data"}, {"word": "colors"}, {"word": "chop"}, {"word": "budget"}, {"word": "brief"}, {"word": "Tina"}, {"word": "spill"}, {"word": "prayer"}, {"word": "costs"}, {"word": "chicks"}, {"word": "betray"}, {"word": "begins"}, {"word": "arrangement"}, {"word": "waiter"}, {"word": "sucker"}, {"word": "scam"}, {"word": "rats"}, {"word": "Leslie"}, {"word": "fraud"}, {"word": "flu"}, {"word": "brush"}, {"word": "anyone's"}, {"word": "adopted"}, {"word": "tables"}, {"word": "sympathy"}, {"word": "pill"}, {"word": "pee"}, {"word": "lean"}, {"word": "filthy"}, {"word": "cliff"}, {"word": "burger"}, {"word": "web"}, {"word": "seventeen"}, {"word": "landed"}, {"word": "expression"}, {"word": "entrance"}, {"word": "employee"}, {"word": "drawing"}, {"word": "cap"}, {"word": "bunny"}, {"word": "bracelet"}, {"word": "thirteen"}, {"word": "scout"}, {"word": "principal"}, {"word": "pays"}, {"word": "Jen's"}, {"word": "fairly"}, {"word": "facility"}, {"word": "Dru"}, {"word": "deeper"}, {"word": "arrive"}, {"word": "unique"}, {"word": "tracking"}, {"word": "spite"}, {"word": "shed"}, {"word": "recommend"}, {"word": "oughta"}, {"word": "nanny"}, {"word": "naive"}, {"word": "menu"}, {"word": "grades"}, {"word": "diet"}, {"word": "corn"}, {"word": "authorities"}, {"word": "Walsh"}, {"word": "separated"}, {"word": "roses"}, {"word": "patch"}, {"word": "grey"}, {"word": "dime"}, {"word": "devastated"}, {"word": "description"}, {"word": "tap"}, {"word": "subtle"}, {"word": "include"}, {"word": "Harris"}, {"word": "garrison"}, {"word": "citizen"}, {"word": "bullets"}, {"word": "beans"}, {"word": "Ric"}, {"word": "pile"}, {"word": "metal"}, {"word": "las"}, {"word": "Kelso"}, {"word": "executive"}, {"word": "confirm"}, {"word": "capital"}, {"word": "adults"}, {"word": "Traci"}, {"word": "toe"}, {"word": "strings"}, {"word": "parade"}, {"word": "harbor"}, {"word": "charity's"}, {"word": "bow"}, {"word": "borrowed"}, {"word": "booth"}, {"word": "toys"}, {"word": "straighten"}, {"word": "steak"}, {"word": "status"}, {"word": "remote"}, {"word": "premonition"}, {"word": "poem"}, {"word": "planted"}, {"word": "honored"}, {"word": "youth"}, {"word": "specifically"}, {"word": "meetings"}, {"word": "Lopez"}, {"word": "exam"}, {"word": "daily"}, {"word": "convenient"}, {"word": "traveling"}, {"word": "matches"}, {"word": "laying"}, {"word": "insisted"}, {"word": "crystal"}, {"word": "apply"}, {"word": "units"}, {"word": "technology"}, {"word": "steel"}, {"word": "muscle"}, {"word": "Joel"}, {"word": "dish"}, {"word": "aitoro"}, {"word": "sis"}, {"word": "sales"}, {"word": "Marie"}, {"word": "legend"}, {"word": "kindly"}, {"word": "grandson"}, {"word": "donor"}, {"word": "wheels"}, {"word": "temper"}, {"word": "teenager"}, {"word": "strategy"}, {"word": "richard's"}, {"word": "proven"}, {"word": "mothers"}, {"word": "monitor"}, {"word": "iron"}, {"word": "houses"}, {"word": "eternity"}, {"word": "denial"}, {"word": "Dana"}, {"word": "couples"}, {"word": "backwards"}, {"word": "tent"}, {"word": "swell"}, {"word": "noon"}, {"word": "happiest"}, {"word": "gotcha"}, {"word": "episode"}, {"word": "drives"}, {"word": "bacon"}, {"word": "thinkin"}, {"word": "spirits"}, {"word": "potion"}, {"word": "holes"}, {"word": "fence"}, {"word": "dial"}, {"word": "affairs"}, {"word": "acts"}, {"word": "whatsoever"}, {"word": "ward"}, {"word": "rehearsal"}, {"word": "proved"}, {"word": "overheard"}, {"word": "nuclear"}, {"word": "lemme"}, {"word": "leather"}, {"word": "hostage"}, {"word": "hammer"}, {"word": "faced"}, {"word": "discover"}, {"word": "constant"}, {"word": "Catherine"}, {"word": "bench"}, {"word": "tryin"}, {"word": "taxi"}, {"word": "shove"}, {"word": "sets"}, {"word": "Reggie"}, {"word": "moron"}, {"word": "limits"}, {"word": "Jeff"}, {"word": "impress"}, {"word": "gray"}, {"word": "entitled"}, {"word": "connect"}, {"word": "pussy"}, {"word": "needle"}, {"word": "Megan"}, {"word": "limit"}, {"word": "lad"}, {"word": "intelligent"}, {"word": "instant"}, {"word": "forms"}, {"word": "disagree"}, {"word": "tiger"}, {"word": "stinks"}, {"word": "Rianna"}, {"word": "recover"}, {"word": "Paul's"}, {"word": "Louie"}, {"word": "losers"}, {"word": "groom"}, {"word": "gesture"}, {"word": "developed"}, {"word": "constantly"}, {"word": "blocks"}, {"word": "bartender"}, {"word": "tunnel"}, {"word": "suspects"}, {"word": "sealed"}, {"word": "removed"}, {"word": "paradise"}, {"word": "legally"}, {"word": "illness"}, {"word": "hears"}, {"word": "dresses"}, {"word": "aye"}, {"word": "vehicle"}, {"word": "thy"}, {"word": "teachers"}, {"word": "sheet"}, {"word": "receive"}, {"word": "psychic"}, {"word": "night's"}, {"word": "Melissa"}, {"word": "denied"}, {"word": "teenage"}, {"word": "Sierra"}, {"word": "rabbit"}, {"word": "puppy"}, {"word": "Patty"}, {"word": "knocking"}, {"word": "judging"}, {"word": "bible"}, {"word": "behalf"}, {"word": "accidentally"}, {"word": "waking"}, {"word": "ton"}, {"word": "superior"}, {"word": "slack"}, {"word": "seek"}, {"word": "rumor"}, {"word": "Natalie's"}, {"word": "manners"}, {"word": "homeless"}, {"word": "hollow"}, {"word": "hills"}, {"word": "Gordon"}, {"word": "desperately"}, {"word": "critical"}, {"word": "coward"}, {"word": "Winslow"}, {"word": "theme"}, {"word": "tapes"}, {"word": "sheets"}, {"word": "referring"}, {"word": "personnel"}, {"word": "Perkins"}, {"word": "ol"}, {"word": "Maxie"}, {"word": "item"}, {"word": "Genoa"}, {"word": "gear"}, {"word": "du"}, {"word": "majesty"}, {"word": "forest"}, {"word": "fans"}, {"word": "exposed"}, {"word": "cried"}, {"word": "tons"}, {"word": "spells"}, {"word": "producer"}, {"word": "launch"}, {"word": "jay"}, {"word": "instinct"}, {"word": "extreme"}, {"word": "belief"}, {"word": "quote"}, {"word": "motorcycle"}, {"word": "convincing"}, {"word": "appeal"}, {"word": "advance"}, {"word": "greater"}, {"word": "fashioned"}, {"word": "empire"}, {"word": "aids"}, {"word": "accomplished"}, {"word": "ye"}, {"word": "Tammy"}, {"word": "Noah"}, {"word": "mommy's"}, {"word": "grip"}, {"word": "bump"}, {"word": "Wallace"}, {"word": "upsetting"}, {"word": "soldiers"}, {"word": "scheduled"}, {"word": "production"}, {"word": "needing"}, {"word": "Maddie"}, {"word": "invisible"}, {"word": "forgiveness"}, {"word": "feds"}, {"word": "complex"}, {"word": "compare"}, {"word": "cloud"}, {"word": "champion"}, {"word": "bothers"}, {"word": "blank"}, {"word": "treasure"}, {"word": "tooth"}, {"word": "territory"}, {"word": "sacred"}, {"word": "Mon"}, {"word": "Jessica's"}, {"word": "inviting"}, {"word": "inner"}, {"word": "earn"}, {"word": "compromise"}, {"word": "cocktail"}, {"word": "tramp"}, {"word": "temperature"}, {"word": "signing"}, {"word": "messenger"}, {"word": "landing"}, {"word": "jabot"}, {"word": "intimate"}, {"word": "dignity"}, {"word": "dealt"}, {"word": "souls"}, {"word": "root"}, {"word": "Nicky"}, {"word": "informed"}, {"word": "gods"}, {"word": "Felicia"}, {"word": "entertainment"}, {"word": "dressing"}, {"word": "cigarettes"}, {"word": "blessing"}, {"word": "billion"}, {"word": "Alistair"}, {"word": "upper"}, {"word": "Marge"}, {"word": "manner"}, {"word": "lightning"}, {"word": "leak"}, {"word": "heaven's"}, {"word": "fond"}, {"word": "Corky"}, {"word": "Atlantic"}, {"word": "alternative"}, {"word": "seduce"}, {"word": "players"}, {"word": "operate"}, {"word": "modern"}, {"word": "liquor"}, {"word": "June"}, {"word": "Janine"}, {"word": "fingerprints"}, {"word": "enchantment"}, {"word": "butters"}, {"word": "stuffed"}, {"word": "Stavros"}, {"word": "Rome"}, {"word": "Murphy"}, {"word": "filed"}, {"word": "emotionally"}, {"word": "division"}, {"word": "conditions"}, {"word": "Cameron"}, {"word": "uhm"}, {"word": "transplant"}, {"word": "tips"}, {"word": "Shayne"}, {"word": "powder"}, {"word": "passes"}, {"word": "oxygen"}, {"word": "nicely"}, {"word": "Macy"}, {"word": "lunatic"}, {"word": "hid"}, {"word": "drill"}, {"word": "designs"}, {"word": "complain"}, {"word": "announcement"}, {"word": "visitors"}, {"word": "unfortunate"}, {"word": "slap"}, {"word": "pumpkin"}, {"word": "prayers"}, {"word": "plug"}, {"word": "organization"}, {"word": "opens"}, {"word": "oath"}, {"word": "O'Neill"}, {"word": "mutual"}, {"word": "hockey"}, {"word": "graduate"}, {"word": "confirmed"}, {"word": "broad"}, {"word": "yacht"}, {"word": "spa"}, {"word": "remembers"}, {"word": "horn"}, {"word": "fried"}, {"word": "extraordinary"}, {"word": "bait"}, {"word": "appearance"}, {"word": "Angela"}, {"word": "abuse"}, {"word": "Warton"}, {"word": "sworn"}, {"word": "stare"}, {"word": "Sal"}, {"word": "safely"}, {"word": "reunion"}, {"word": "plot"}, {"word": "Nigel"}, {"word": "burst"}, {"word": "aha"}, {"word": "might've"}, {"word": "Frederick"}, {"word": "experiment"}, {"word": "experienced"}, {"word": "dive"}, {"word": "commission"}, {"word": "chaos"}, {"word": "cells"}, {"word": "aboard"}, {"word": "returning"}, {"word": "lesbian"}, {"word": "independent"}, {"word": "expose"}, {"word": "environment"}, {"word": "buddies"}, {"word": "trusting"}, {"word": "spider"}, {"word": "smaller"}, {"word": "mountains"}, {"word": "Mandy"}, {"word": "Jessie"}, {"word": "booze"}, {"word": "tattoo"}, {"word": "sweep"}, {"word": "sore"}, {"word": "scudder"}, {"word": "Reynolds"}, {"word": "properly"}, {"word": "parole"}, {"word": "Manhattan"}, {"word": "effective"}, {"word": "ditch"}, {"word": "decides"}, {"word": "canceled"}, {"word": "bulldog"}, {"word": "bra"}, {"word": "Antonio's"}, {"word": "speaks"}, {"word": "Spanish"}, {"word": "rubber"}, {"word": "reaching"}, {"word": "glow"}, {"word": "foundation"}, {"word": "women's"}, {"word": "wears"}, {"word": "thirsty"}, {"word": "Stewart"}, {"word": "skull"}, {"word": "Sidney"}, {"word": "scotch"}, {"word": "ringing"}, {"word": "dorm"}, {"word": "dining"}, {"word": "Carla"}, {"word": "bend"}, {"word": "unexpected"}, {"word": "systems"}, {"word": "sob"}, {"word": "pat"}, {"word": "pancakes"}, {"word": "Michael's"}, {"word": "harsh"}, {"word": "flattered"}, {"word": "existence"}, {"word": "ahhh"}, {"word": "troubles"}, {"word": "proposed"}, {"word": "fights"}, {"word": "favourite"}, {"word": "eats"}, {"word": "driven"}, {"word": "computers"}, {"word": "chin"}, {"word": "bravo"}, {"word": "seal"}, {"word": "rage"}, {"word": "Luke's"}, {"word": "causes"}, {"word": "bubble"}, {"word": "border"}, {"word": "undercover"}, {"word": "spoiled"}, {"word": "Sloane"}, {"word": "shine"}, {"word": "rug"}, {"word": "identify"}, {"word": "destroying"}, {"word": "deputy"}, {"word": "deliberately"}, {"word": "conspiracy"}, {"word": "clothing"}, {"word": "thoughtful"}, {"word": "similar"}, {"word": "sandwiches"}, {"word": "plates"}, {"word": "nails"}, {"word": "miracles"}, {"word": "investment"}, {"word": "fridge"}, {"word": "drank"}, {"word": "contrary"}, {"word": "beloved"}, {"word": "Alonzo"}, {"word": "allergic"}, {"word": "washed"}, {"word": "stalking"}, {"word": "solved"}, {"word": "sack"}, {"word": "misses"}, {"word": "hope's"}, {"word": "forgiven"}, {"word": "erica's"}, {"word": "earl"}, {"word": "cuz"}, {"word": "bent"}, {"word": "approval"}, {"word": "practical"}, {"word": "organized"}, {"word": "Norma"}, {"word": "MacIver"}, {"word": "jungle"}, {"word": "involve"}, {"word": "industry"}, {"word": "fuel"}, {"word": "dragging"}, {"word": "dancer"}, {"word": "cotton"}, {"word": "cooked"}, {"word": "Weston"}, {"word": "Renee"}, {"word": "possession"}, {"word": "pointing"}, {"word": "foul"}, {"word": "editor"}, {"word": "dull"}, {"word": "Clark"}, {"word": "beneath"}, {"word": "ages"}, {"word": "SI"}, {"word": "peanut"}, {"word": "horror"}, {"word": "heels"}, {"word": "grass"}, {"word": "faking"}, {"word": "deaf"}, {"word": "Billie"}, {"word": "stunt"}, {"word": "portrait"}, {"word": "painted"}, {"word": "July"}, {"word": "jealousy"}, {"word": "hopeless"}, {"word": "fears"}, {"word": "cuts"}, {"word": "conclusion"}, {"word": "volunteer"}, {"word": "sword"}, {"word": "scenario"}, {"word": "satellite"}, {"word": "Rosie"}, {"word": "Riley"}, {"word": "necklace"}, {"word": "men's"}, {"word": "Evans"}, {"word": "crashed"}, {"word": "Christopher"}, {"word": "chapel"}, {"word": "accuse"}, {"word": "teddy"}, {"word": "restraining"}, {"word": "naughty"}, {"word": "Jason's"}, {"word": "humans"}, {"word": "homicide"}, {"word": "helicopter"}, {"word": "formal"}, {"word": "Fitzgerald"}, {"word": "firing"}, {"word": "shortly"}, {"word": "safer"}, {"word": "missy"}, {"word": "diamonds"}, {"word": "devoted"}, {"word": "auction"}, {"word": "videotape"}, {"word": "tore"}, {"word": "stores"}, {"word": "reservations"}, {"word": "pops"}, {"word": "Joseph"}, {"word": "ew"}, {"word": "Arthur"}, {"word": "appetite"}, {"word": "anybody's"}, {"word": "wounds"}, {"word": "vanquish"}, {"word": "symbol"}, {"word": "prevent"}, {"word": "patrol"}, {"word": "Jordan"}, {"word": "ironic"}, {"word": "flow"}, {"word": "fathers"}, {"word": "excitement"}, {"word": "anyhow"}, {"word": "tearing"}, {"word": "sends"}, {"word": "sam's"}, {"word": "rape"}, {"word": "lo"}, {"word": "laughed"}, {"word": "function"}, {"word": "core"}, {"word": "charmed"}, {"word": "carpet"}, {"word": "bowling"}, {"word": "belly"}, {"word": "whatever's"}, {"word": "sub"}, {"word": "shark"}, {"word": "Scotty"}, {"word": "Miller"}, {"word": "Miami"}, {"word": "Lucy's"}, {"word": "Jefferson"}, {"word": "dealer"}, {"word": "cooperate"}, {"word": "bachelor"}, {"word": "Anne"}, {"word": "accomplish"}, {"word": "wakes"}, {"word": "struggle"}, {"word": "spotted"}, {"word": "sorts"}, {"word": "Rico"}, {"word": "reservation"}, {"word": "fort"}, {"word": "coke"}, {"word": "ashes"}, {"word": "yards"}, {"word": "votes"}, {"word": "tastes"}, {"word": "supposedly"}, {"word": "Marcus"}, {"word": "loft"}, {"word": "intentions"}, {"word": "integrity"}, {"word": "wished"}, {"word": "Wendy"}, {"word": "towels"}, {"word": "suspected"}, {"word": "slightly"}, {"word": "qualified"}, {"word": "profit"}, {"word": "log"}, {"word": "Lenny"}, {"word": "Java"}, {"word": "investigating"}, {"word": "inappropriate"}, {"word": "immediate"}, {"word": "ginger"}, {"word": "companies"}, {"word": "backed"}, {"word": "sunset"}, {"word": "pan"}, {"word": "pa"}, {"word": "owned"}, {"word": "nation"}, {"word": "lipstick"}, {"word": "lawn"}, {"word": "compassion"}, {"word": "cafeteria"}, {"word": "belonged"}, {"word": "affected"}, {"word": "scarf"}, {"word": "precisely"}, {"word": "obsession"}, {"word": "management"}, {"word": "loses"}, {"word": "lighten"}, {"word": "Jake's"}, {"word": "infection"}, {"word": "granddaughter"}, {"word": "explode"}, {"word": "chemistry"}, {"word": "balcony"}, {"word": "this'll"}, {"word": "storage"}, {"word": "spying"}, {"word": "publicity"}, {"word": "exists"}, {"word": "employees"}, {"word": "depend"}, {"word": "Cynthia"}, {"word": "cue"}, {"word": "cracked"}, {"word": "conscious"}, {"word": "aww"}, {"word": "Anya"}, {"word": "ally"}, {"word": "ace"}, {"word": "accounts"}, {"word": "absurd"}, {"word": "vicious"}, {"word": "tools"}, {"word": "strongly"}, {"word": "rap"}, {"word": "potato"}, {"word": "invented"}, {"word": "hood"}, {"word": "forbid"}, {"word": "directions"}, {"word": "defendant"}, {"word": "bare"}, {"word": "announce"}, {"word": "Alcazar's"}, {"word": "screwing"}, {"word": "samples"}, {"word": "salesman"}, {"word": "rounds"}, {"word": "robbed"}, {"word": "leap"}, {"word": "lakeview"}, {"word": "Ken"}, {"word": "insanity"}, {"word": "injury"}, {"word": "genetic"}, {"word": "freaks"}, {"word": "fighter"}, {"word": "document"}, {"word": "burden"}, {"word": "why's"}, {"word": "swallow"}, {"word": "slave"}, {"word": "reveal"}, {"word": "religious"}, {"word": "possibilities"}, {"word": "martini"}, {"word": "kidnap"}, {"word": "gown"}, {"word": "entering"}, {"word": "Donny"}, {"word": "chairs"}, {"word": "wishing"}, {"word": "statue"}, {"word": "stalker"}, {"word": "setup"}, {"word": "serial"}, {"word": "sandy"}, {"word": "punished"}, {"word": "Mikey"}, {"word": "Gilmore"}, {"word": "dramatic"}, {"word": "dismissed"}, {"word": "criminals"}, {"word": "carver"}, {"word": "blade"}, {"word": "seventh"}, {"word": "regrets"}, {"word": "raped"}, {"word": "quarters"}, {"word": "produce"}, {"word": "pony"}, {"word": "Oliver"}, {"word": "lamp"}, {"word": "dentist"}, {"word": "anyways"}, {"word": "anonymous"}, {"word": "added"}, {"word": "tech"}, {"word": "semester"}, {"word": "risks"}, {"word": "regarding"}, {"word": "owes"}, {"word": "magazines"}, {"word": "machines"}, {"word": "lungs"}, {"word": "explaining"}, {"word": "delicate"}, {"word": "Delia"}, {"word": "child's"}, {"word": "tricked"}, {"word": "oldest"}, {"word": "Liv"}, {"word": "eager"}, {"word": "doomed"}, {"word": "coffin"}, {"word": "click"}, {"word": "cafe"}, {"word": "buttons"}, {"word": "bureau"}, {"word": "adoption"}, {"word": "Wes"}, {"word": "Tyler"}, {"word": "traditional"}, {"word": "surrender"}, {"word": "stones"}, {"word": "stab"}, {"word": "sickness"}, {"word": "scum"}, {"word": "Oswald"}, {"word": "loop"}, {"word": "independence"}, {"word": "generation"}, {"word": "floating"}, {"word": "envelope"}, {"word": "entered"}, {"word": "combination"}, {"word": "chamber"}, {"word": "casino"}, {"word": "worn"}, {"word": "vault"}, {"word": "sunshine"}, {"word": "sorel"}, {"word": "pretended"}, {"word": "potatoes"}, {"word": "plea"}, {"word": "photograph"}, {"word": "petty"}, {"word": "payback"}, {"word": "misunderstood"}, {"word": "kiddo"}, {"word": "healing"}, {"word": "Franklin"}, {"word": "fianc\u00e9e"}, {"word": "Derek"}, {"word": "cascade"}, {"word": "capeside"}, {"word": "Buster"}, {"word": "application"}, {"word": "stabbed"}, {"word": "remarkable"}, {"word": "random"}, {"word": "guitar"}, {"word": "frog"}, {"word": "cabinet"}, {"word": "brat"}, {"word": "wrestling"}, {"word": "Willie"}, {"word": "sixth"}, {"word": "scale"}, {"word": "privilege"}, {"word": "pencil"}, {"word": "passionate"}, {"word": "nerves"}, {"word": "lawsuit"}, {"word": "kidney"}, {"word": "disturbed"}, {"word": "crossing"}, {"word": "cozy"}, {"word": "avatar"}, {"word": "associate"}, {"word": "tire"}, {"word": "shirts"}, {"word": "Sara"}, {"word": "required"}, {"word": "posted"}, {"word": "oven"}, {"word": "ordering"}, {"word": "mill"}, {"word": "journal"}, {"word": "gallery"}, {"word": "delay"}, {"word": "clubs"}, {"word": "risky"}, {"word": "purple"}, {"word": "nest"}, {"word": "monsters"}, {"word": "honorable"}, {"word": "grounded"}, {"word": "gene"}, {"word": "favour"}, {"word": "electric"}, {"word": "Doyle"}, {"word": "culture"}, {"word": "closest"}, {"word": "Brenda's"}, {"word": "breast"}, {"word": "breakdown"}, {"word": "attempted"}, {"word": "Tony's"}, {"word": "placed"}, {"word": "Martha"}, {"word": "India"}, {"word": "Dallas"}, {"word": "conflict"}, {"word": "bald"}, {"word": "Anthony"}, {"word": "actress"}, {"word": "abandon"}, {"word": "wisdom"}, {"word": "steam"}, {"word": "scar"}, {"word": "pole"}, {"word": "duh"}, {"word": "collar"}, {"word": "CD"}, {"word": "worthless"}, {"word": "warlock"}, {"word": "sucking"}, {"word": "standards"}, {"word": "resources"}, {"word": "photographs"}, {"word": "introduced"}, {"word": "injured"}, {"word": "graduation"}, {"word": "enormous"}, {"word": "Dixon"}, {"word": "disturbing"}, {"word": "disturb"}, {"word": "distract"}, {"word": "deals"}, {"word": "conclusions"}, {"word": "baker"}, {"word": "vodka"}, {"word": "situations"}, {"word": "require"}, {"word": "Ramsey"}, {"word": "muffin"}, {"word": "mid"}, {"word": "measure"}, {"word": "le"}, {"word": "Jeffrey"}, {"word": "dishes"}, {"word": "crawling"}, {"word": "congress"}, {"word": "children's"}, {"word": "briefcase"}, {"word": "Albert"}, {"word": "wiped"}, {"word": "whistle"}, {"word": "sits"}, {"word": "roast"}, {"word": "rented"}, {"word": "pigs"}, {"word": "penis"}, {"word": "massive"}, {"word": "link"}, {"word": "Greek"}, {"word": "flirting"}, {"word": "existed"}, {"word": "deposit"}, {"word": "damaged"}, {"word": "bottles"}, {"word": "Vanessa's"}, {"word": "unknown"}, {"word": "types"}, {"word": "topic"}, {"word": "robin"}, {"word": "riot"}, {"word": "overreacting"}, {"word": "minimum"}, {"word": "logical"}, {"word": "impact"}, {"word": "hostile"}, {"word": "embarrass"}, {"word": "casual"}, {"word": "beacon"}, {"word": "amusing"}, {"word": "altar"}, {"word": "values"}, {"word": "ultimate"}, {"word": "skinny"}, {"word": "recognized"}, {"word": "maintain"}, {"word": "goods"}, {"word": "covers"}, {"word": "Claus"}, {"word": "battery"}, {"word": "survival"}, {"word": "Spellman"}, {"word": "skirt"}, {"word": "shave"}, {"word": "prisoners"}, {"word": "porch"}, {"word": "med"}, {"word": "ghosts"}, {"word": "favors"}, {"word": "drops"}, {"word": "dizzy"}, {"word": "chili"}, {"word": "breasts"}, {"word": "Benjamin"}, {"word": "begun"}, {"word": "beaten"}, {"word": "advise"}, {"word": "transferred"}, {"word": "strikes"}, {"word": "rehab"}, {"word": "raw"}, {"word": "photographer"}, {"word": "peaceful"}, {"word": "leery"}, {"word": "kraft"}, {"word": "Houston"}, {"word": "hooker"}, {"word": "heavens"}, {"word": "fortunately"}, {"word": "fooling"}, {"word": "expectations"}, {"word": "draft"}, {"word": "citizens"}, {"word": "cigar"}, {"word": "active"}, {"word": "weakness"}, {"word": "Vincent"}, {"word": "ski"}, {"word": "ships"}, {"word": "ranch"}, {"word": "practicing"}, {"word": "musical"}, {"word": "movement"}, {"word": "Lynne"}, {"word": "individual"}, {"word": "homes"}, {"word": "executed"}, {"word": "examine"}, {"word": "documents"}, {"word": "cranes"}, {"word": "column"}, {"word": "bribe"}, {"word": "beers"}, {"word": "task"}, {"word": "species"}, {"word": "sail"}, {"word": "rum"}, {"word": "resort"}, {"word": "rash"}, {"word": "prescription"}, {"word": "operating"}, {"word": "Munson"}, {"word": "Mars"}, {"word": "hush"}, {"word": "fuzzy"}, {"word": "fragile"}, {"word": "forensics"}, {"word": "expense"}, {"word": "drugged"}, {"word": "differences"}, {"word": "cows"}, {"word": "conduct"}, {"word": "comic"}, {"word": "bingo"}, {"word": "bells"}, {"word": "Bebe"}, {"word": "avenue"}, {"word": "attacking"}, {"word": "assigned"}, {"word": "visitor"}, {"word": "suitcase"}, {"word": "sources"}, {"word": "sorta"}, {"word": "scan"}, {"word": "rod"}, {"word": "payment"}, {"word": "op"}, {"word": "motor"}, {"word": "mini"}, {"word": "manticore"}, {"word": "inspired"}, {"word": "insecure"}, {"word": "imagining"}, {"word": "hardest"}, {"word": "gamble"}, {"word": "Donald"}, {"word": "clerk"}, {"word": "yea"}, {"word": "wrist"}, {"word": "what'll"}, {"word": "tube"}, {"word": "starters"}, {"word": "silk"}, {"word": "pump"}, {"word": "pale"}, {"word": "nicer"}, {"word": "haul"}, {"word": "guardian"}, {"word": "flies"}, {"word": "dodge"}, {"word": "demands"}, {"word": "boot"}, {"word": "arts"}, {"word": "African"}, {"word": "Truman"}, {"word": "thumb"}, {"word": "there'd"}, {"word": "limited"}, {"word": "lighter"}, {"word": "Karl"}, {"word": "how're"}, {"word": "elders"}, {"word": "Connie"}, {"word": "connections"}, {"word": "shooter"}, {"word": "quietly"}, {"word": "pulls"}, {"word": "lion"}, {"word": "Janet"}, {"word": "idiots"}, {"word": "factor"}, {"word": "erase"}, {"word": "denying"}, {"word": "Cox"}, {"word": "attacks"}, {"word": "ankle"}, {"word": "amnesia"}, {"word": "accepting"}, {"word": "Ruby"}, {"word": "ooo"}, {"word": "hunter"}, {"word": "heartbeat"}, {"word": "gal"}, {"word": "fry"}, {"word": "Devane"}, {"word": "Cummings"}, {"word": "confront"}, {"word": "backing"}, {"word": "Ann"}, {"word": "register"}, {"word": "phrase"}, {"word": "operations"}, {"word": "minus"}, {"word": "meets"}, {"word": "legitimate"}, {"word": "hurricane"}, {"word": "fixing"}, {"word": "communication"}, {"word": "Cindy"}, {"word": "bucket"}, {"word": "boats"}, {"word": "auto"}, {"word": "arrogant"}, {"word": "Vicki"}, {"word": "tuna"}, {"word": "supper"}, {"word": "studies"}, {"word": "slightest"}, {"word": "sins"}, {"word": "sayin"}, {"word": "recipe"}, {"word": "pier"}, {"word": "paternity"}, {"word": "mason"}, {"word": "lamb"}, {"word": "kisses"}, {"word": "humiliating"}, {"word": "genuine"}, {"word": "catholic"}, {"word": "Webber"}, {"word": "snack"}, {"word": "rational"}, {"word": "pointed"}, {"word": "passport"}, {"word": "minded"}, {"word": "Latin"}, {"word": "Jeremy"}, {"word": "guessed"}, {"word": "Grace's"}, {"word": "fianc\u00e9"}, {"word": "display"}, {"word": "dip"}, {"word": "Brooke's"}, {"word": "advanced"}, {"word": "weddings"}, {"word": "unh"}, {"word": "tumor"}, {"word": "teams"}, {"word": "reported"}, {"word": "marco"}, {"word": "Ida"}, {"word": "humiliated"}, {"word": "hee"}, {"word": "destruction"}, {"word": "copies"}, {"word": "closely"}, {"word": "Carlos"}, {"word": "bid"}, {"word": "banana"}, {"word": "august"}, {"word": "aspirin"}, {"word": "academy"}, {"word": "wig"}, {"word": "Turk"}, {"word": "throughout"}, {"word": "spray"}, {"word": "picks"}, {"word": "occur"}, {"word": "logic"}, {"word": "knight"}, {"word": "Grissom"}, {"word": "fields"}, {"word": "eyed"}, {"word": "equal"}, {"word": "drowning"}, {"word": "contacts"}, {"word": "Shakespeare"}, {"word": "ritual"}, {"word": "perfume"}, {"word": "Mitzi"}, {"word": "Madison"}, {"word": "Kelly's"}, {"word": "hiring"}, {"word": "hating"}, {"word": "ham"}, {"word": "generally"}, {"word": "fusion"}, {"word": "error"}, {"word": "elected"}, {"word": "docks"}, {"word": "creatures"}, {"word": "Becky"}, {"word": "visions"}, {"word": "thanking"}, {"word": "thankful"}, {"word": "sock"}, {"word": "replaced"}, {"word": "reed"}, {"word": "Noel"}, {"word": "nineteen"}, {"word": "nick's"}, {"word": "fork"}, {"word": "comedy"}, {"word": "analysis"}, {"word": "Yale"}, {"word": "throws"}, {"word": "teenagers"}, {"word": "studied"}, {"word": "stressed"}, {"word": "slice"}, {"word": "shore"}, {"word": "rolls"}, {"word": "requires"}, {"word": "plead"}, {"word": "palm"}, {"word": "ladder"}, {"word": "kicks"}, {"word": "jr"}, {"word": "Irish"}, {"word": "ford"}, {"word": "detectives"}, {"word": "assured"}, {"word": "Alison's"}, {"word": "widow"}, {"word": "tomorrow's"}, {"word": "tissue"}, {"word": "tellin"}, {"word": "shallow"}, {"word": "responsibilities"}, {"word": "repay"}, {"word": "rejected"}, {"word": "permanently"}, {"word": "howdy"}, {"word": "hack"}, {"word": "girlfriends"}, {"word": "deadly"}, {"word": "comforting"}, {"word": "ceiling"}, {"word": "bonus"}, {"word": "Anderson"}, {"word": "verdict"}, {"word": "maintenance"}, {"word": "jar"}, {"word": "insensitive"}, {"word": "heather"}, {"word": "factory"}, {"word": "aim"}, {"word": "triple"}, {"word": "spilled"}, {"word": "Ruth"}, {"word": "respected"}, {"word": "recovered"}, {"word": "messy"}, {"word": "interrupted"}, {"word": "Halliwell"}, {"word": "entry"}, {"word": "car's"}, {"word": "blond"}, {"word": "bleed"}, {"word": "benefits"}, {"word": "wardrobe"}, {"word": "Tenney"}, {"word": "takin"}, {"word": "significant"}, {"word": "objective"}, {"word": "murders"}, {"word": "foster"}, {"word": "doo"}, {"word": "ding"}, {"word": "Clyde"}, {"word": "chart"}, {"word": "backs"}, {"word": "airplane"}, {"word": "workers"}, {"word": "waves"}, {"word": "underestimate"}, {"word": "ties"}, {"word": "soccer"}, {"word": "registered"}, {"word": "multiple"}, {"word": "Miranda"}, {"word": "justify"}, {"word": "harmless"}, {"word": "frustrated"}, {"word": "fold"}, {"word": "Enzo"}, {"word": "Dante"}, {"word": "convention"}, {"word": "communicate"}, {"word": "bugging"}, {"word": "attraction"}, {"word": "arson"}, {"word": "whack"}, {"word": "Wade"}, {"word": "tits"}, {"word": "salary"}, {"word": "rumors"}, {"word": "residence"}, {"word": "party's"}, {"word": "obligation"}, {"word": "medium"}, {"word": "liking"}, {"word": "Laura's"}, {"word": "development"}, {"word": "develop"}, {"word": "dearest"}, {"word": "David's"}, {"word": "Danny's"}, {"word": "congratulate"}, {"word": "April"}, {"word": "alliance"}, {"word": "vengeance"}, {"word": "Switzerland"}, {"word": "severe"}, {"word": "rack"}, {"word": "puzzle"}, {"word": "puerto"}, {"word": "guidance"}, {"word": "fires"}, {"word": "dickie"}, {"word": "courtesy"}, {"word": "caller"}, {"word": "bounce"}, {"word": "blamed"}, {"word": "wizard"}, {"word": "tops"}, {"word": "Terrance"}, {"word": "sh"}, {"word": "repair"}, {"word": "quiz"}, {"word": "prep"}, {"word": "now's"}, {"word": "involves"}, {"word": "headquarters"}, {"word": "curiosity"}, {"word": "codes"}, {"word": "circles"}, {"word": "bears"}, {"word": "barbecue"}, {"word": "troops"}, {"word": "Susie"}, {"word": "Sunnydale"}, {"word": "spinning"}, {"word": "scores"}, {"word": "pursue"}, {"word": "psychotic"}, {"word": "Mexican"}, {"word": "groups"}, {"word": "Denver"}, {"word": "cough"}, {"word": "claimed"}, {"word": "Brooklyn"}, {"word": "accusations"}, {"word": "shares"}, {"word": "rushing"}, {"word": "resent"}, {"word": "money's"}, {"word": "laughs"}, {"word": "gathered"}, {"word": "freshman"}, {"word": "envy"}, {"word": "drown"}, {"word": "Cristian's"}, {"word": "chemical"}, {"word": "branch"}, {"word": "Bartlet"}, {"word": "asses"}, {"word": "Virginia"}, {"word": "sofa"}, {"word": "scientist"}, {"word": "poster"}, {"word": "Murdock"}, {"word": "models"}, {"word": "McKinnon"}, {"word": "islands"}, {"word": "highness"}, {"word": "drain"}, {"word": "dock"}, {"word": "cha"}, {"word": "apologies"}, {"word": "welfare"}, {"word": "victor's"}, {"word": "theirs"}, {"word": "stat"}, {"word": "stall"}, {"word": "spots"}, {"word": "somewhat"}, {"word": "solo"}, {"word": "Ryan's"}, {"word": "realizes"}, {"word": "psych"}, {"word": "mmmm"}, {"word": "Lois"}, {"word": "jazz"}, {"word": "hawk"}, {"word": "fools"}, {"word": "finishing"}, {"word": "Connor"}, {"word": "beard"}, {"word": "album"}, {"word": "wee"}, {"word": "understandable"}, {"word": "unable"}, {"word": "treats"}, {"word": "theatre"}, {"word": "succeed"}, {"word": "stir"}, {"word": "Sammy"}, {"word": "relaxed"}, {"word": "makin"}, {"word": "inches"}, {"word": "gratitude"}, {"word": "faithful"}, {"word": "Dennis"}, {"word": "bin"}, {"word": "accent"}, {"word": "zip"}, {"word": "witter"}, {"word": "wandering"}, {"word": "shell"}, {"word": "Shane"}, {"word": "regardless"}, {"word": "racing"}, {"word": "que"}, {"word": "Maurice"}, {"word": "locate"}, {"word": "inevitable"}, {"word": "griffin"}, {"word": "Gretel"}, {"word": "Ellie"}, {"word": "deed"}, {"word": "Debbie"}, {"word": "crushed"}, {"word": "controlling"}, {"word": "western"}, {"word": "taxes"}, {"word": "Tara"}, {"word": "smelled"}, {"word": "sheep"}, {"word": "settlement"}, {"word": "rocky"}, {"word": "robe"}, {"word": "retired"}, {"word": "poet"}, {"word": "opposed"}, {"word": "marked"}, {"word": "Hannibal"}, {"word": "Greenlee's"}, {"word": "gossip"}, {"word": "gambling"}, {"word": "determine"}, {"word": "Cuba"}, {"word": "cosmetics"}, {"word": "cent"}, {"word": "accidents"}, {"word": "tricky"}, {"word": "surprising"}, {"word": "stiff"}, {"word": "sincere"}, {"word": "shield"}, {"word": "rushed"}, {"word": "rice"}, {"word": "resume"}, {"word": "reporting"}, {"word": "refrigerator"}, {"word": "reference"}, {"word": "preparing"}, {"word": "nightmares"}, {"word": "mijo"}, {"word": "ignoring"}, {"word": "hunch"}, {"word": "fog"}, {"word": "fireworks"}, {"word": "drowned"}, {"word": "crown"}, {"word": "cooperation"}, {"word": "brass"}, {"word": "accurate"}, {"word": "whispering"}, {"word": "Stevens"}, {"word": "Stella"}, {"word": "sophisticated"}, {"word": "Ron"}, {"word": "religion"}, {"word": "luggage"}, {"word": "ll"}, {"word": "lemon"}, {"word": "investigate"}, {"word": "hike"}, {"word": "explore"}, {"word": "emotion"}, {"word": "dragon"}, {"word": "creek"}, {"word": "crashing"}, {"word": "contacted"}, {"word": "complications"}, {"word": "cherry"}, {"word": "CEO"}, {"word": "Bruno"}, {"word": "acid"}, {"word": "z"}, {"word": "shining"}, {"word": "Russia"}, {"word": "rolled"}, {"word": "righteous"}, {"word": "reconsider"}, {"word": "Jonathan"}, {"word": "inspiration"}, {"word": "goody"}, {"word": "geek"}, {"word": "frightening"}, {"word": "festival"}, {"word": "ethics"}, {"word": "creeps"}, {"word": "courthouse"}, {"word": "camping"}, {"word": "assistance"}, {"word": "affection"}, {"word": "vow"}, {"word": "Smythe"}, {"word": "protest"}, {"word": "lodge"}, {"word": "haircut"}, {"word": "forcing"}, {"word": "eternal"}, {"word": "essay"}, {"word": "chairman"}, {"word": "Batman"}, {"word": "baked"}, {"word": "apologized"}, {"word": "vibe"}, {"word": "stud"}, {"word": "stargate"}, {"word": "sailor"}, {"word": "respects"}, {"word": "receipt"}, {"word": "operator"}, {"word": "mami"}, {"word": "Lindsey"}, {"word": "Kathy"}, {"word": "includes"}, {"word": "hats"}, {"word": "goat"}, {"word": "exclusive"}, {"word": "destructive"}, {"word": "define"}, {"word": "defeat"}, {"word": "cheek"}, {"word": "adore"}, {"word": "adopt"}, {"word": "warrior"}, {"word": "voted"}, {"word": "tracked"}, {"word": "Sloan"}, {"word": "signals"}, {"word": "shorts"}, {"word": "Rory's"}, {"word": "reminding"}, {"word": "relative"}, {"word": "pond"}, {"word": "ninth"}, {"word": "Lester"}, {"word": "Harper"}, {"word": "floors"}, {"word": "dough"}, {"word": "creations"}, {"word": "continues"}, {"word": "cancelled"}, {"word": "Cabot"}, {"word": "barrel"}, {"word": "Adam's"}, {"word": "tuck"}, {"word": "snuck"}, {"word": "slight"}, {"word": "reporters"}, {"word": "rear"}, {"word": "pressing"}, {"word": "Pacific"}, {"word": "novel"}, {"word": "newspapers"}, {"word": "magnificent"}, {"word": "madame"}, {"word": "Lincoln"}, {"word": "lick"}, {"word": "lazy"}, {"word": "goddess"}, {"word": "glorious"}, {"word": "fiancee"}, {"word": "candidate"}, {"word": "brick"}, {"word": "Boyd"}, {"word": "bits"}, {"word": "Australia"}, {"word": "activities"}, {"word": "visitation"}, {"word": "teen"}, {"word": "scholarship"}, {"word": "sane"}, {"word": "previous"}, {"word": "Michigan"}, {"word": "kingdom"}, {"word": "kindness"}, {"word": "Ivy's"}, {"word": "im"}, {"word": "flames"}, {"word": "sunny"}, {"word": "shoulda"}, {"word": "Robinson"}, {"word": "rescued"}, {"word": "mattress"}, {"word": "Maria's"}, {"word": "lounge"}, {"word": "lobster"}, {"word": "lifted"}, {"word": "label"}, {"word": "importantly"}, {"word": "glove"}, {"word": "enterprises"}, {"word": "driver's"}, {"word": "disappointment"}, {"word": "condo"}, {"word": "cemetery"}, {"word": "beings"}, {"word": "admitting"}, {"word": "yelled"}, {"word": "waving"}, {"word": "spoon"}, {"word": "screech"}, {"word": "satisfaction"}, {"word": "requested"}, {"word": "reads"}, {"word": "plants"}, {"word": "nun"}, {"word": "navy"}, {"word": "nailed"}, {"word": "Hannah"}, {"word": "Elvis"}, {"word": "elephant"}, {"word": "described"}, {"word": "dedicated"}, {"word": "Christian"}, {"word": "certificate"}, {"word": "centuries"}, {"word": "annual"}, {"word": "worm"}, {"word": "tick"}, {"word": "resting"}, {"word": "primary"}, {"word": "polish"}, {"word": "monkeys"}, {"word": "marvelous"}, {"word": "fuss"}, {"word": "funds"}, {"word": "defensive"}, {"word": "Cortlandt"}, {"word": "compete"}, {"word": "chased"}, {"word": "bush"}, {"word": "balloon"}, {"word": "Alexander"}, {"word": "sailing"}, {"word": "provided"}, {"word": "pockets"}, {"word": "Lilith"}, {"word": "Lila"}, {"word": "Hattie"}, {"word": "filing"}, {"word": "depression"}, {"word": "conversations"}, {"word": "consideration"}, {"word": "consciousness"}, {"word": "worlds"}, {"word": "Joyce"}, {"word": "innocence"}, {"word": "indicate"}, {"word": "grandmother's"}, {"word": "Gail"}, {"word": "fucker"}, {"word": "freaky"}, {"word": "forehead"}, {"word": "Foley"}, {"word": "bam"}, {"word": "appeared"}, {"word": "aggressive"}, {"word": "trailer"}, {"word": "summers"}, {"word": "slam"}, {"word": "Seinfeld"}, {"word": "retirement"}, {"word": "quitting"}, {"word": "pry"}, {"word": "porn"}, {"word": "person's"}, {"word": "narrow"}, {"word": "levels"}, {"word": "Kay's"}, {"word": "inform"}, {"word": "fee"}, {"word": "Eugene"}, {"word": "encourage"}, {"word": "dug"}, {"word": "delighted"}, {"word": "daylight"}, {"word": "danced"}, {"word": "currently"}, {"word": "confidential"}, {"word": "chew"}, {"word": "Billy's"}, {"word": "Ben's"}, {"word": "aunts"}, {"word": "washing"}, {"word": "warden"}, {"word": "Vic"}, {"word": "tossed"}, {"word": "temple"}, {"word": "spectra"}, {"word": "Rick's"}, {"word": "permit"}, {"word": "mistress"}, {"word": "marrow"}, {"word": "lined"}, {"word": "implying"}, {"word": "hatred"}, {"word": "grill"}, {"word": "formula"}, {"word": "Esther"}, {"word": "en"}, {"word": "efforts"}, {"word": "corpse"}, {"word": "clues"}, {"word": "Wally"}, {"word": "sober"}, {"word": "relatives"}, {"word": "promotion"}, {"word": "peel"}, {"word": "offended"}, {"word": "morgue"}, {"word": "larger"}, {"word": "Jude"}, {"word": "infected"}, {"word": "humanity"}, {"word": "eww"}, {"word": "Emily's"}, {"word": "electricity"}, {"word": "electrical"}, {"word": "distraction"}, {"word": "chopper"}, {"word": "cart"}, {"word": "broadcast"}, {"word": "wired"}, {"word": "violation"}, {"word": "ve"}, {"word": "suspended"}, {"word": "sting"}, {"word": "promising"}, {"word": "harassment"}, {"word": "glue"}, {"word": "gathering"}, {"word": "deer"}, {"word": "d'angelo"}, {"word": "cursed"}, {"word": "controlled"}, {"word": "content"}, {"word": "combat"}, {"word": "calendar"}, {"word": "brutal"}, {"word": "bing"}, {"word": "Bette"}, {"word": "assets"}, {"word": "warlocks"}, {"word": "wagon"}, {"word": "Vietnam"}, {"word": "unpleasant"}, {"word": "tan"}, {"word": "Stacy"}, {"word": "Shirley"}, {"word": "robot"}, {"word": "Roberts"}, {"word": "proving"}, {"word": "priorities"}, {"word": "pepper"}, {"word": "observation"}, {"word": "mustn't"}, {"word": "lease"}, {"word": "killers"}, {"word": "grows"}, {"word": "flame"}, {"word": "domestic"}, {"word": "divine"}, {"word": "disappearance"}, {"word": "depressing"}, {"word": "thrill"}, {"word": "terminal"}, {"word": "sitter"}, {"word": "ribs"}, {"word": "offers"}, {"word": "naw"}, {"word": "Morris"}, {"word": "Judy"}, {"word": "flush"}, {"word": "exception"}, {"word": "earrings"}, {"word": "deadline"}, {"word": "corporal"}, {"word": "collapsed"}, {"word": "update"}, {"word": "snapped"}, {"word": "smack"}, {"word": "Orleans"}, {"word": "offices"}, {"word": "melt"}, {"word": "madness"}, {"word": "Indians"}, {"word": "figuring"}, {"word": "eagle"}, {"word": "delusional"}, {"word": "coulda"}, {"word": "burnt"}, {"word": "actors"}, {"word": "trips"}, {"word": "tender"}, {"word": "sperm"}, {"word": "specialist"}, {"word": "scientific"}, {"word": "satan"}, {"word": "realise"}, {"word": "pork"}, {"word": "popped"}, {"word": "planes"}, {"word": "Kev"}, {"word": "interrogation"}, {"word": "institution"}, {"word": "included"}, {"word": "gates"}, {"word": "esteem"}, {"word": "Dorothy"}, {"word": "communications"}, {"word": "choosing"}, {"word": "choir"}, {"word": "undo"}, {"word": "pres"}, {"word": "prayed"}, {"word": "plague"}, {"word": "manipulate"}, {"word": "lifestyle"}, {"word": "lance"}, {"word": "insulting"}, {"word": "honour"}, {"word": "detention"}, {"word": "delightful"}, {"word": "daisy"}, {"word": "coffeehouse"}, {"word": "chess"}, {"word": "betrayal"}, {"word": "apologizing"}, {"word": "adjust"}, {"word": "wrecked"}, {"word": "wont"}, {"word": "whipped"}, {"word": "rides"}, {"word": "reminder"}, {"word": "psychological"}, {"word": "principle"}, {"word": "monsieur"}, {"word": "injuries"}, {"word": "fame"}, {"word": "faint"}, {"word": "confusion"}, {"word": "clouds"}, {"word": "Christ's"}, {"word": "bon"}, {"word": "bake"}, {"word": "Teri"}, {"word": "sang"}, {"word": "nearest"}, {"word": "Korea"}, {"word": "industries"}, {"word": "illusion"}, {"word": "Gorman"}, {"word": "execution"}, {"word": "distress"}, {"word": "definition"}, {"word": "cutter"}, {"word": "creating"}, {"word": "correctly"}, {"word": "complaint"}, {"word": "chickens"}, {"word": "Charlotte"}, {"word": "Caitlin"}, {"word": "blocked"}, {"word": "trophy"}, {"word": "tortured"}, {"word": "structure"}, {"word": "rot"}, {"word": "risking"}, {"word": "pointless"}, {"word": "pearl"}, {"word": "Nixon"}, {"word": "Lancelot"}, {"word": "household"}, {"word": "heir"}, {"word": "handing"}, {"word": "eighth"}, {"word": "dumping"}, {"word": "cups"}, {"word": "Chloe's"}, {"word": "alibi"}, {"word": "absence"}, {"word": "vital"}, {"word": "towers"}, {"word": "Tokyo"}, {"word": "thus"}, {"word": "struggling"}, {"word": "shiny"}, {"word": "risked"}, {"word": "refer"}, {"word": "mummy"}, {"word": "mint"}, {"word": "keeper"}, {"word": "Joey's"}, {"word": "involvement"}, {"word": "hose"}, {"word": "hobby"}, {"word": "fortunate"}, {"word": "Fleischman"}, {"word": "fitting"}, {"word": "curtain"}, {"word": "counseling"}, {"word": "coats"}, {"word": "addition"}, {"word": "wit"}, {"word": "Winston"}, {"word": "transport"}, {"word": "technical"}, {"word": "Shelly"}, {"word": "rode"}, {"word": "puppet"}, {"word": "prior"}, {"word": "opportunities"}, {"word": "modeling"}, {"word": "memo"}, {"word": "liquid"}, {"word": "irresponsible"}, {"word": "humiliation"}, {"word": "hiya"}, {"word": "freakin"}, {"word": "fez"}, {"word": "felony"}, {"word": "Evelyn"}, {"word": "Detroit"}, {"word": "choke"}, {"word": "blackmailing"}, {"word": "appreciated"}, {"word": "Willard"}, {"word": "tabloid"}, {"word": "suspicion"}, {"word": "recovering"}, {"word": "rally"}, {"word": "psychology"}, {"word": "pledge"}, {"word": "panicked"}, {"word": "nursery"}, {"word": "louder"}, {"word": "jeans"}, {"word": "investigator"}, {"word": "identified"}, {"word": "homecoming"}, {"word": "Helena's"}, {"word": "height"}, {"word": "graduated"}, {"word": "frustrating"}, {"word": "fabric"}, {"word": "dot"}, {"word": "distant"}, {"word": "cock"}, {"word": "buys"}, {"word": "busting"}, {"word": "buff"}, {"word": "wax"}, {"word": "sleeve"}, {"word": "se"}, {"word": "pudding"}, {"word": "products"}, {"word": "philosophy"}, {"word": "Juliet"}, {"word": "japan"}, {"word": "irony"}, {"word": "hospitals"}, {"word": "dope"}, {"word": "declare"}, {"word": "autopsy"}, {"word": "workin"}, {"word": "torch"}, {"word": "substitute"}, {"word": "scandal"}, {"word": "prick"}, {"word": "limb"}, {"word": "leaf"}, {"word": "laser"}, {"word": "lady's"}, {"word": "hysterical"}, {"word": "growth"}, {"word": "goddamnit"}, {"word": "fetch"}, {"word": "dimension"}, {"word": "day's"}, {"word": "crowded"}, {"word": "cousins"}, {"word": "clip"}, {"word": "climbing"}, {"word": "bonding"}, {"word": "bee"}, {"word": "Barnes"}, {"word": "approved"}, {"word": "yeh"}, {"word": "woah"}, {"word": "veronica"}, {"word": "ultimately"}, {"word": "trusts"}, {"word": "terror"}, {"word": "roller"}, {"word": "returns"}, {"word": "negotiate"}, {"word": "millennium"}, {"word": "mi"}, {"word": "marsh"}, {"word": "majority"}, {"word": "lethal"}, {"word": "length"}, {"word": "iced"}, {"word": "fantasies"}, {"word": "element"}, {"word": "deeds"}, {"word": "Clarke"}, {"word": "cigars"}, {"word": "Bradley"}, {"word": "bore"}, {"word": "babysitter"}, {"word": "sponge"}, {"word": "sleepy"}, {"word": "Rita"}, {"word": "questioned"}, {"word": "peek"}, {"word": "outrageous"}, {"word": "nigger"}, {"word": "medal"}, {"word": "Kiriakis"}, {"word": "insulted"}, {"word": "hu"}, {"word": "grudge"}, {"word": "established"}, {"word": "driveway"}, {"word": "deserted"}, {"word": "definite"}, {"word": "capture"}, {"word": "beep"}, {"word": "Adams"}, {"word": "wires"}, {"word": "weed"}, {"word": "suggestions"}, {"word": "searched"}, {"word": "owed"}, {"word": "originally"}, {"word": "nickname"}, {"word": "mo"}, {"word": "lighting"}, {"word": "lend"}, {"word": "films"}, {"word": "drunken"}, {"word": "demanding"}, {"word": "Costanza"}, {"word": "conviction"}, {"word": "characters"}, {"word": "Carlo"}, {"word": "bumped"}, {"word": "Alaska"}, {"word": "weigh"}, {"word": "weasel"}, {"word": "valentine"}, {"word": "touches"}, {"word": "tempted"}, {"word": "supreme"}, {"word": "shout"}, {"word": "rocket"}, {"word": "resolve"}, {"word": "relate"}, {"word": "poisoned"}, {"word": "pip"}, {"word": "Phoebe's"}, {"word": "Pete's"}, {"word": "occasionally"}, {"word": "Molly's"}, {"word": "meals"}, {"word": "maker"}, {"word": "invitations"}, {"word": "intruder"}, {"word": "haunted"}, {"word": "Harrison"}, {"word": "fur"}, {"word": "footage"}, {"word": "depending"}, {"word": "bonds"}, {"word": "bogus"}, {"word": "Berlin"}, {"word": "Barton"}, {"word": "autograph"}, {"word": "Arizona"}, {"word": "apples"}, {"word": "affects"}, {"word": "tolerate"}, {"word": "stepping"}, {"word": "spontaneous"}, {"word": "southern"}, {"word": "sleeps"}, {"word": "probation"}, {"word": "presentation"}, {"word": "performed"}, {"word": "Manny"}, {"word": "identical"}, {"word": "herb"}, {"word": "fist"}, {"word": "cycle"}, {"word": "cooler"}, {"word": "banner"}, {"word": "associates"}, {"word": "Aaron's"}, {"word": "yankee"}, {"word": "streak"}, {"word": "spectacular"}, {"word": "sector"}, {"word": "muscles"}, {"word": "lasted"}, {"word": "Isaac's"}, {"word": "increase"}, {"word": "hostages"}, {"word": "heroin"}, {"word": "havin"}, {"word": "hardware"}, {"word": "habits"}, {"word": "fisher"}, {"word": "encouraging"}, {"word": "cult"}, {"word": "consult"}, {"word": "burgers"}, {"word": "Bristow"}, {"word": "boyfriends"}, {"word": "bailed"}, {"word": "baggage"}, {"word": "association"}, {"word": "wealthy"}, {"word": "watches"}, {"word": "versus"}, {"word": "troubled"}, {"word": "torturing"}, {"word": "teasing"}, {"word": "sweetest"}, {"word": "stations"}, {"word": "sip"}, {"word": "Shawn's"}, {"word": "rag"}, {"word": "qualities"}, {"word": "postpone"}, {"word": "pad"}, {"word": "overwhelmed"}, {"word": "maniac"}, {"word": "Malkovich"}, {"word": "impulse"}, {"word": "hut"}, {"word": "follows"}, {"word": "duchess"}, {"word": "classy"}, {"word": "charging"}, {"word": "celebrity"}, {"word": "Barbara's"}, {"word": "angel's"}, {"word": "amazed"}, {"word": "slater"}, {"word": "scenes"}, {"word": "rising"}, {"word": "revealed"}, {"word": "representing"}, {"word": "policeman"}, {"word": "offensive"}, {"word": "mug"}, {"word": "hypocrite"}, {"word": "humiliate"}, {"word": "hideous"}, {"word": "hairy"}, {"word": "Gunn"}, {"word": "finals"}, {"word": "experiences"}, {"word": "d'ya"}, {"word": "courts"}, {"word": "costumes"}, {"word": "Chilton"}, {"word": "Carrie"}, {"word": "captured"}, {"word": "bolt"}, {"word": "bluffing"}, {"word": "betting"}, {"word": "bein"}, {"word": "bedtime"}, {"word": "ay"}, {"word": "alpha"}, {"word": "alcoholic"}, {"word": "waters"}, {"word": "visual"}, {"word": "vegetable"}, {"word": "Vaughn"}, {"word": "tray"}, {"word": "Thompson"}, {"word": "suspicions"}, {"word": "sticky"}, {"word": "spreading"}, {"word": "splendid"}, {"word": "smiles"}, {"word": "shrimp"}, {"word": "shouting"}, {"word": "roots"}, {"word": "ransom"}, {"word": "pressed"}, {"word": "nooo"}, {"word": "Liza's"}, {"word": "jew"}, {"word": "intent"}, {"word": "grieving"}, {"word": "gladly"}, {"word": "Georgia"}, {"word": "fling"}, {"word": "eliminate"}, {"word": "disorder"}, {"word": "Courtney's"}, {"word": "cocaine"}, {"word": "chancellor"}, {"word": "cereal"}, {"word": "arrives"}, {"word": "aaah"}, {"word": "yum"}, {"word": "Tracy"}, {"word": "technique"}, {"word": "subway"}, {"word": "strain"}, {"word": "statements"}, {"word": "sonofabitch"}, {"word": "servant"}, {"word": "roads"}, {"word": "resident"}, {"word": "republican"}, {"word": "paralyzed"}, {"word": "orb"}, {"word": "lotta"}, {"word": "locks"}, {"word": "Lawrence"}, {"word": "guaranteed"}, {"word": "European"}, {"word": "dummy"}, {"word": "discipline"}, {"word": "despise"}, {"word": "dental"}, {"word": "corporation"}, {"word": "Clint"}, {"word": "cherish"}, {"word": "carries"}, {"word": "briefing"}, {"word": "bluff"}, {"word": "batteries"}, {"word": "atmosphere"}, {"word": "assholes"}, {"word": "whatta"}, {"word": "tux"}, {"word": "Trent"}, {"word": "sounding"}, {"word": "servants"}, {"word": "rifle"}, {"word": "presume"}, {"word": "mamie"}, {"word": "Kevin's"}, {"word": "Heidi"}, {"word": "handwriting"}, {"word": "goals"}, {"word": "gin"}, {"word": "gale"}, {"word": "fainted"}, {"word": "elements"}, {"word": "dried"}, {"word": "cape"}, {"word": "allright"}, {"word": "allowing"}, {"word": "acknowledge"}, {"word": "whiskey"}, {"word": "whacked"}, {"word": "toxic"}, {"word": "skating"}, {"word": "shepherd"}, {"word": "reliable"}, {"word": "quicker"}, {"word": "penalty"}, {"word": "panel"}, {"word": "overwhelming"}, {"word": "nearby"}, {"word": "Mitchell"}, {"word": "lining"}, {"word": "importance"}, {"word": "ike"}, {"word": "harassing"}, {"word": "global"}, {"word": "Fran"}, {"word": "fatal"}, {"word": "endless"}, {"word": "elsewhere"}, {"word": "dolls"}, {"word": "convict"}, {"word": "butler"}, {"word": "bold"}, {"word": "ballet"}, {"word": "\u00f1"}, {"word": "whatcha"}, {"word": "unlikely"}, {"word": "spiritual"}, {"word": "shutting"}, {"word": "separation"}, {"word": "rusty"}, {"word": "recording"}, {"word": "positively"}, {"word": "overcome"}, {"word": "mount"}, {"word": "Michel"}, {"word": "method"}, {"word": "manual"}, {"word": "helmet"}, {"word": "goddam"}, {"word": "failing"}, {"word": "essence"}, {"word": "dose"}, {"word": "diagnosis"}, {"word": "cured"}, {"word": "claiming"}, {"word": "bully"}, {"word": "airline"}, {"word": "ahold"}, {"word": "yearbook"}, {"word": "various"}, {"word": "triangle"}, {"word": "tempting"}, {"word": "shelf"}, {"word": "Shawna"}, {"word": "rig"}, {"word": "pursuit"}, {"word": "prosecution"}, {"word": "pouring"}, {"word": "possessed"}, {"word": "partnership"}, {"word": "november"}, {"word": "Miguel's"}, {"word": "Lorenzo"}, {"word": "Lindsay'"}, {"word": "humble"}, {"word": "greedy"}, {"word": "countries"}, {"word": "wonders"}, {"word": "tsk"}, {"word": "thorough"}, {"word": "spine"}, {"word": "shotgun"}, {"word": "reckless"}, {"word": "Rath"}, {"word": "railroad"}, {"word": "psychiatric"}, {"word": "na"}, {"word": "meaningless"}, {"word": "latte"}, {"word": "Kong"}, {"word": "jammed"}, {"word": "ignored"}, {"word": "fiance"}, {"word": "exposure"}, {"word": "exhibit"}, {"word": "evidently"}, {"word": "duties"}, {"word": "contempt"}, {"word": "compromised"}, {"word": "capacity"}, {"word": "cans"}, {"word": "weekends"}, {"word": "urge"}, {"word": "thunder"}, {"word": "theft"}, {"word": "Sykes"}, {"word": "suing"}, {"word": "shipment"}, {"word": "scissors"}, {"word": "responding"}, {"word": "refuses"}, {"word": "proposition"}, {"word": "porter"}, {"word": "noises"}, {"word": "matching"}, {"word": "marine"}, {"word": "Mack"}, {"word": "Lulu"}, {"word": "located"}, {"word": "leon"}, {"word": "legacy"}, {"word": "ink"}, {"word": "hormones"}, {"word": "HIV"}, {"word": "hail"}, {"word": "grandchildren"}, {"word": "godfather"}, {"word": "gently"}, {"word": "establish"}, {"word": "eastern"}, {"word": "darryl"}, {"word": "crane's"}, {"word": "contracts"}, {"word": "compound"}, {"word": "Buffy's"}, {"word": "worldwide"}, {"word": "smashed"}, {"word": "sexually"}, {"word": "sentimental"}, {"word": "senor"}, {"word": "scored"}, {"word": "patient's"}, {"word": "nicest"}, {"word": "marketing"}, {"word": "manipulated"}, {"word": "jaw"}, {"word": "intern"}, {"word": "handcuffs"}, {"word": "Freddy"}, {"word": "framed"}, {"word": "errands"}, {"word": "entertaining"}, {"word": "discovery"}, {"word": "crib"}, {"word": "carriage"}, {"word": "barge"}, {"word": "awards"}, {"word": "attending"}, {"word": "ambassador"}, {"word": "videos"}, {"word": "Thelma"}, {"word": "tab"}, {"word": "spends"}, {"word": "slipping"}, {"word": "seated"}, {"word": "rubbing"}, {"word": "rely"}, {"word": "reject"}, {"word": "recommendation"}, {"word": "reckon"}, {"word": "ratings"}, {"word": "Pam"}, {"word": "McManus"}, {"word": "Klinger"}, {"word": "headaches"}, {"word": "Gil"}, {"word": "float"}, {"word": "embrace"}, {"word": "corners"}, {"word": "whining"}, {"word": "wa"}, {"word": "turner"}, {"word": "sweating"}, {"word": "sole"}, {"word": "skipped"}, {"word": "rolf"}, {"word": "restore"}, {"word": "receiving"}, {"word": "population"}, {"word": "pep"}, {"word": "olive"}, {"word": "mountie"}, {"word": "motives"}, {"word": "mama's"}, {"word": "listens"}, {"word": "Korean"}, {"word": "jeep"}, {"word": "Hudson"}, {"word": "heroes"}, {"word": "heart's"}, {"word": "Cristobel"}, {"word": "controls"}, {"word": "cleaner"}, {"word": "cheerleader"}, {"word": "Balsom"}, {"word": "au"}, {"word": "wooden"}, {"word": "unnecessary"}, {"word": "stunning"}, {"word": "slim"}, {"word": "shipping"}, {"word": "scent"}, {"word": "santa's"}, {"word": "quest"}, {"word": "Quartermaine"}, {"word": "praise"}, {"word": "pose"}, {"word": "Montega"}, {"word": "luxury"}, {"word": "loosen"}, {"word": "Kyle's"}, {"word": "Keri's"}, {"word": "Janice"}, {"word": "info"}, {"word": "hum"}, {"word": "hottest"}, {"word": "haunt"}, {"word": "Hastings"}, {"word": "gracious"}, {"word": "git"}, {"word": "forgiving"}, {"word": "fleet"}, {"word": "errand"}, {"word": "emperor"}, {"word": "Doris"}, {"word": "cakes"}, {"word": "blames"}, {"word": "Beverly"}, {"word": "abortion"}, {"word": "worship"}, {"word": "theories"}, {"word": "strict"}, {"word": "sketch"}, {"word": "shifts"}, {"word": "Sebastian"}, {"word": "plotting"}, {"word": "physician"}, {"word": "perimeter"}, {"word": "passage"}, {"word": "pals"}, {"word": "Mick"}, {"word": "mere"}, {"word": "meg"}, {"word": "mattered"}, {"word": "Lonigan"}, {"word": "longest"}, {"word": "jews"}, {"word": "interference"}, {"word": "Hong"}, {"word": "Hamilton"}, {"word": "grease"}, {"word": "Gavin"}, {"word": "eyewitness"}, {"word": "enthusiasm"}, {"word": "encounter"}, {"word": "diapers"}, {"word": "Craig's"}, {"word": "artists"}, {"word": "Alec"}, {"word": "strongest"}, {"word": "shaken"}, {"word": "serves"}, {"word": "punched"}, {"word": "projects"}, {"word": "portal"}, {"word": "outer"}, {"word": "nazi"}, {"word": "Monte"}, {"word": "jewels"}, {"word": "Hal's"}, {"word": "concrete"}, {"word": "Columbia"}, {"word": "colleagues"}, {"word": "catches"}, {"word": "carrot"}, {"word": "bearing"}, {"word": "backyard"}, {"word": "academic"}, {"word": "winds"}, {"word": "whisper"}, {"word": "volume"}, {"word": "terrorists"}, {"word": "Serena"}, {"word": "September"}, {"word": "sabotage"}, {"word": "pope"}, {"word": "pea"}, {"word": "organs"}, {"word": "needy"}, {"word": "mock"}, {"word": "mentor"}, {"word": "measures"}, {"word": "Marvin"}, {"word": "listed"}, {"word": "lex"}, {"word": "Kenyon"}, {"word": "January"}, {"word": "Illinois"}, {"word": "Forman"}, {"word": "cuff"}, {"word": "civilization"}, {"word": "Caribbean"}, {"word": "breeze"}, {"word": "articles"}, {"word": "Adler"}, {"word": "yummy"}, {"word": "writes"}, {"word": "woof"}, {"word": "who'll"}, {"word": "Viki's"}, {"word": "valid"}, {"word": "skipper"}, {"word": "sands"}, {"word": "rarely"}, {"word": "rabbi"}, {"word": "prank"}, {"word": "performing"}, {"word": "obnoxious"}, {"word": "mates"}, {"word": "Jasper"}, {"word": "improve"}, {"word": "ii"}, {"word": "hereby"}, {"word": "gabby"}, {"word": "faked"}, {"word": "Electra"}, {"word": "cheeks"}, {"word": "cellar"}, {"word": "Broadway"}, {"word": "whitelighter"}, {"word": "void"}, {"word": "trucks"}, {"word": "tomato"}, {"word": "substance"}, {"word": "strangle"}, {"word": "sour"}, {"word": "skill"}, {"word": "senate"}, {"word": "purchase"}, {"word": "native"}, {"word": "muffins"}, {"word": "maximum"}, {"word": "interfering"}, {"word": "hoh"}, {"word": "Gina's"}, {"word": "fiction"}, {"word": "exotic"}, {"word": "demonic"}, {"word": "colored"}, {"word": "clearing"}, {"word": "civilian"}, {"word": "Calvin"}, {"word": "Burke"}, {"word": "buildings"}, {"word": "brooks"}, {"word": "boutique"}, {"word": "Barrington"}, {"word": "winters"}, {"word": "trading"}, {"word": "terrace"}, {"word": "Suzanne"}, {"word": "speaker"}, {"word": "smoked"}, {"word": "skiing"}, {"word": "seed"}, {"word": "righty"}, {"word": "relations"}, {"word": "quack"}, {"word": "published"}, {"word": "preliminary"}, {"word": "Petey"}, {"word": "pact"}, {"word": "outstanding"}, {"word": "opinions"}, {"word": "Nevada"}, {"word": "knot"}, {"word": "ketchup"}, {"word": "items"}, {"word": "examined"}, {"word": "disappearing"}, {"word": "Cordy"}, {"word": "coin"}, {"word": "circuit"}, {"word": "Barrett"}, {"word": "assist"}, {"word": "administration"}, {"word": "Walt"}, {"word": "violet"}, {"word": "uptight"}, {"word": "Travis"}, {"word": "ticking"}, {"word": "terrifying"}, {"word": "tease"}, {"word": "Tabitha's"}, {"word": "Syd"}, {"word": "swamp"}, {"word": "secretly"}, {"word": "rejection"}, {"word": "reflection"}, {"word": "realizing"}, {"word": "rays"}, {"word": "Pennsylvania"}, {"word": "partly"}, {"word": "October"}, {"word": "mentally"}, {"word": "Marone"}, {"word": "jurisdiction"}, {"word": "Frasier's"}, {"word": "doubted"}, {"word": "deception"}, {"word": "crucial"}, {"word": "congressman"}, {"word": "cheesy"}, {"word": "chambers"}, {"word": "bitches"}, {"word": "arrival"}, {"word": "visited"}, {"word": "toto"}, {"word": "supporting"}, {"word": "stalling"}, {"word": "shook"}, {"word": "scouts"}, {"word": "scoop"}, {"word": "ribbon"}, {"word": "reserve"}, {"word": "raid"}, {"word": "notion"}, {"word": "Milo"}, {"word": "Melanie"}, {"word": "income"}, {"word": "immune"}, {"word": "hay"}, {"word": "grandma's"}, {"word": "expects"}, {"word": "edition"}, {"word": "Easter"}, {"word": "destined"}, {"word": "constitution"}, {"word": "classroom"}, {"word": "boobs"}, {"word": "bets"}, {"word": "bathing"}, {"word": "appreciation"}, {"word": "appointed"}, {"word": "accomplice"}, {"word": "Whitney's"}, {"word": "wander"}, {"word": "shoved"}, {"word": "sewer"}, {"word": "seeking"}, {"word": "scroll"}, {"word": "retire"}, {"word": "peach"}, {"word": "paintings"}, {"word": "nude"}, {"word": "lasts"}, {"word": "fugitive"}, {"word": "freezer"}, {"word": "et"}, {"word": "discount"}, {"word": "cranky"}, {"word": "crank"}, {"word": "clowns"}, {"word": "clearance"}, {"word": "buffalo"}, {"word": "bodyguard"}, {"word": "anxiety"}, {"word": "accountant"}, {"word": "Abby's"}, {"word": "whoops"}, {"word": "volunteered"}, {"word": "terrorist"}, {"word": "tales"}, {"word": "talents"}, {"word": "stinking"}, {"word": "snakes"}, {"word": "sessions"}, {"word": "salmon"}, {"word": "resolved"}, {"word": "remotely"}, {"word": "protocol"}, {"word": "nickel"}, {"word": "nana"}, {"word": "Livvie's"}, {"word": "jt"}, {"word": "garlic"}, {"word": "foreman"}, {"word": "decency"}, {"word": "cord"}, {"word": "beds"}, {"word": "beam"}, {"word": "asa's"}, {"word": "areas"}, {"word": "altogether"}, {"word": "uniforms"}, {"word": "tremendous"}, {"word": "summit"}, {"word": "squash"}, {"word": "restaurants"}, {"word": "rank"}, {"word": "profession"}, {"word": "popping"}, {"word": "Philadelphia"}, {"word": "peanuts"}, {"word": "outa"}, {"word": "observe"}, {"word": "myrtle"}, {"word": "lung"}, {"word": "largest"}, {"word": "hangs"}, {"word": "feelin"}, {"word": "experts"}, {"word": "enforcement"}, {"word": "encouraged"}, {"word": "economy"}, {"word": "Duncan"}, {"word": "dudes"}, {"word": "donation"}, {"word": "disguise"}, {"word": "diane's"}, {"word": "curb"}, {"word": "continued"}, {"word": "competitive"}, {"word": "businessman"}, {"word": "bites"}, {"word": "balloons"}, {"word": "antique"}, {"word": "advertising"}, {"word": "ads"}, {"word": "toothbrush"}, {"word": "Rupert"}, {"word": "Roxie"}, {"word": "retreat"}, {"word": "represents"}, {"word": "realistic"}, {"word": "profits"}, {"word": "predict"}, {"word": "panties"}, {"word": "Nora's"}, {"word": "lust"}, {"word": "lid"}, {"word": "Leonard"}, {"word": "landlord"}, {"word": "Kent"}, {"word": "hourglass"}, {"word": "hesitate"}, {"word": "Frank's"}, {"word": "focusing"}, {"word": "equally"}, {"word": "consolation"}, {"word": "champ"}, {"word": "boyfriend's"}, {"word": "babbling"}, {"word": "Angie"}, {"word": "aged"}, {"word": "Virgil"}, {"word": "Troy's"}, {"word": "tipped"}, {"word": "stranded"}, {"word": "smartest"}, {"word": "sg"}, {"word": "Sabrina's"}, {"word": "Richie"}, {"word": "rhythm"}, {"word": "replacement"}, {"word": "repeating"}, {"word": "puke"}, {"word": "psst"}, {"word": "Perry"}, {"word": "paycheck"}, {"word": "overreacted"}, {"word": "mechanic"}, {"word": "macho"}, {"word": "ling"}, {"word": "leadership"}, {"word": "Lawson"}, {"word": "Kendall's"}, {"word": "juvenile"}, {"word": "John's"}, {"word": "images"}, {"word": "grocery"}, {"word": "Geller"}, {"word": "freshen"}, {"word": "Dwight"}, {"word": "Drucilla"}, {"word": "Drake"}, {"word": "disposal"}, {"word": "cuffs"}, {"word": "consent"}, {"word": "cartoon"}, {"word": "caffeine"}, {"word": "broom"}, {"word": "biology"}, {"word": "arguments"}, {"word": "agrees"}, {"word": "Abigail's"}, {"word": "vanished"}, {"word": "unfinished"}, {"word": "tobacco"}, {"word": "tin"}, {"word": "tasty"}, {"word": "syndrome"}, {"word": "stack"}, {"word": "sells"}, {"word": "ripping"}, {"word": "pinch"}, {"word": "Phoenix"}, {"word": "missiles"}, {"word": "isolated"}, {"word": "flattering"}, {"word": "expenses"}, {"word": "dinners"}, {"word": "cos"}, {"word": "colleague"}, {"word": "ciao"}, {"word": "buh"}, {"word": "Belthazor"}, {"word": "Belle's"}, {"word": "attorneys"}, {"word": "Amber's"}, {"word": "woulda"}, {"word": "whereabouts"}, {"word": "wars"}, {"word": "waitin"}, {"word": "visits"}, {"word": "truce"}, {"word": "tripped"}, {"word": "tee"}, {"word": "tasted"}, {"word": "Stu"}, {"word": "steer"}, {"word": "ruling"}, {"word": "Rogers"}, {"word": "rd"}, {"word": "poisoning"}, {"word": "pirate"}, {"word": "nursing"}, {"word": "Maxine"}, {"word": "manipulative"}, {"word": "Mallory"}, {"word": "Lillian"}, {"word": "immature"}, {"word": "husbands"}, {"word": "heel"}, {"word": "granddad"}, {"word": "delivering"}, {"word": "deaths"}, {"word": "condoms"}, {"word": "butts"}, {"word": "automatically"}, {"word": "anchor"}, {"word": "addict"}, {"word": "Trish"}, {"word": "trashed"}, {"word": "tournament"}, {"word": "throne"}, {"word": "Teresa"}, {"word": "slick"}, {"word": "sausage"}, {"word": "raining"}, {"word": "prices"}, {"word": "pasta"}, {"word": "Paloma"}, {"word": "needles"}, {"word": "leaning"}, {"word": "leaders"}, {"word": "judges"}, {"word": "ideal"}, {"word": "detector"}, {"word": "coolest"}, {"word": "casting"}, {"word": "bean"}, {"word": "battles"}, {"word": "batch"}, {"word": "approximately"}, {"word": "appointments"}, {"word": "almighty"}, {"word": "achieve"}, {"word": "vegetables"}, {"word": "trapper"}, {"word": "swinging"}, {"word": "sum"}, {"word": "spark"}, {"word": "ruled"}, {"word": "revolution"}]


var fuse = new Fuse(words, options);


var currentRange = {start:0, end:0};
var currentHolder = null;
var currentSuggestions= null;
var currentNode = null;
var currentTimeout = null;


function showSuggestionHelper(wordSuggestions, onTop){
    currentSuggestions = wordSuggestions;
    removeHelper();
    var suggestionsHolder = document.createElement("div");
    suggestionsHolder.style.width = "50%";
    suggestionsHolder.style.height = "10%";
    suggestionsHolder.style.left = "25%";
    suggestionsHolder.style.backgroundColor = "black";
    suggestionsHolder.style.borderRadius = "25px";
    suggestionsHolder.style.border = "2px solid #ffffff"
    suggestionsHolder.style.position = "fixed";
    if(onTop){
    suggestionsHolder.style.top = "100px";
    }
    else{
        suggestionsHolder.style.top = (window.innerHeight - 200) + "px";
    }

    for(var i = 0 ; i < 3; i++){
        var suggestionHolder = document.createElement('div');
	suggestionHolder.style.position = "relative";
	suggestionHolder.style.width = "33.333%";
	suggestionHolder.style.height = "100%";
	suggestionHolder.style.float = "left";
	suggestionHolder.id = i;
	suggestionHolder.onclick = function(){selectSuggestion(this.id);};
	suggestionHolder.style.cursor = "pointer";

	var suggestionText = document.createElement("div");
	suggestionText.style.position= "relative";
	suggestionText.style.float= "left";
	suggestionText.style.color = "white";
	suggestionText.style.top = "50%";
	suggestionText.style.left = "50%";
	suggestionText.style.transform = "translate(-50%, -50%)";
	suggestionText.textContent = wordSuggestions[i];

        suggestionHolder.appendChild(suggestionText);
	
	suggestionsHolder.appendChild(suggestionHolder);

    }

    currentHolder = suggestionsHolder;
    document.body.appendChild(suggestionsHolder);
    currentTimeout = setTimeout(removeHelper, 5000);
}

function selectSuggestion(index){
    removeHelper();
console.log("index " + index+" ; word "+currentSuggestions[index] + " ; rangestart "+ currentRange.start + " ; rangeend "+currentRange.end);
if(currentNode != null){
    console.log("reolacing");
    console.log(currentNode.nodeName);
    if(currentNode.nodeName == "TEXTAREA"){
    currentNode.setRangeText(currentSuggestions[index] + " ",currentRange.start, currentRange.end, "end");
    }
    else if(currentNode.nodeName == "#text"){
        var tempText = currentNode.textContent;
	console.log(currentRange);
	console.log(tempText);
	var newText = tempText.substring(0,currentRange.start) + currentSuggestions[index] + " ";
	if(currentRange.end < tempText.length){
	    newText += tempText.substring(currentRange.end, tempText.length);
	}
	console.log(tempText.length);
	currentNode.textContent = newText;
	console.log(currentNode);
	window.getSelection().collapse(currentNode, currentRange.start + currentSuggestions[index].length + 1);
    }
    currentNode.focus();

}
               
}

function removeHelper(){
    if(currentHolder != null){
        document.body.removeChild(currentHolder);
    }
    currentHolder = null;
    if(currentTimeout != null){
       clearTimeout(currentTimeout);
       currentTimeout = null;
    }
}


function fade(element) {
    var op = 1;  // initial opacity
    var timer = setInterval(function () {
        if (op <= 0.1){
            clearInterval(timer);
            element.style.display = 'none';
        }
        element.style.opacity = op;
        element.style.filter = 'alpha(opacity=' + op * 100 + ")";
        op -= op * 0.1;
    }, 50);
}


var cumulativeOffset = function(element) {
    var top = 0, left = 0;
    do {
        top += element.offsetTop  || 0;
        left += element.offsetLeft || 0;
        element = element.offsetParent;
    } while(element);

    return {
        top: top,
        left: left
    };
};

function getPosition( el ) {
    var x = 0;
    var y = 0;
    if(typeof el.offsetTop == "undefined")
        return getPosition(el.parentElement);
    while( el && !isNaN( el.offsetLeft ) && !isNaN( el.offsetTop ) ) {
    x += el.offsetLeft - window.scrollX;
    y += el.offsetTop - window.scrollY;
    el = el.offsetParent;
    }
    return { top: y, left: x };
}

function keypress(e){
    var selection = window.getSelection();
    console.log(selection);
    var text = "";
    var currentPosition = 0;
    var wordStart = 0;
    
    console.log(e.which + " " +e.keyCode + " " + e.ctrlKey); 
    var pressCharacterCode = String.fromCharCode(e.which);
    if(pressCharacterCode == 'M' && e.ctrlKey){
        selectSuggestion(0);
    }
    else if(e.which == 188 && e.ctrlKey){
        selectSuggestion(1);
    }
    else if(e.which == 190 && e.ctrlKey){
        selectSuggestion(2);
    }
    if(selection.anchorNode.nodeName == "#text"){
        text = selection.anchorNode.textContent;
	currentPosition = selection.focusOffset;
	currentNode = selection.anchorNode;
    }
    else if(selection.anchorNode.nodeName == "TEXTAREA"){
        text = selection.anchorNode.value;
        currentPosition = selection.anchorNode.selectionStart;
	currentNode = selection.anchorNode;

    }
    else if(document.activeElement.nodeName == "TEXTAREA"){
        text = document.activeElement.value;
	currentPosition = document.activeElement.selectionStart;
        console.log(document.activeElement.selectionStart);
	currentNode = document.activeElement;
    }
    else {
        return;
    }
    wordStart = 0 ; 
    for( var i = 0 ; i < currentPosition; i++){
	if((text[i] < 'a' || text[i] >'z')&&(text[i] <'A' || text[i] > 'Z')){
	    wordStart = i+1;
	}
    }
    console.log(wordStart);
    var word = text.substring(wordStart, currentPosition+1);
    currentRange = {start:wordStart, end:currentPosition+1};
    console.log("Searching "+word);
    var d = new Date();
    console.log("Search start " + d.getTime());
    var suggestions = fuse.search(word);
    var sWords = [];
    console.log(getPosition(currentNode));
    if(suggestions.length > 0){
        for(var i =0 ; i < suggestions.length; i++){
            sWords.push(suggestions[i].word);
	    console.log(suggestions[i].word);
	    if(i == 2)
	        break;
	}
	console.log(sWords);

	showSuggestionHelper(sWords, getPosition(currentNode).top > 300);
    }
    else{
        removeHelper();
    }
    var d2 = new Date();
    console.log("Search end " + d2.getTime());

}
