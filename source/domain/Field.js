import DomainType from "../types/Domain.js";
import Predicate from "./Predicate.js";
import {PredicateError} from "../errors.js";
import Storeable from "../types/Storeable.js";
import * as types from "../types.js";
import cache from "../cache.js";
import {constructible} from "../attributes.js";
import {defined, is, maybe} from "../invariants.js";

const builtins = Object.values(types).reduce((aggregate, Type) => {
  aggregate[Type.instance] = Type;
  return aggregate;
}, {});

const as_array = field => ({"type": field[0], "predicates": field.slice(1)});

const as_object = field => field instanceof Array ? as_array(field) : field;

const as_function = field => ({in: field,
  type: field(undefined, {}).constructor});

const as_non_constructible =
  field => typeof field === "function" ? as_function(field) : as_object(field);

const parse = field => constructible(field)
  ? {type: field}
  : as_non_constructible(field);

export default class Field {
  constructor(property, definition, options) {
    defined(property, "`property` required");
    this.property = property;
    this.definition = parse(definition);
    this.options = options ?? {transient: false, optional: false};
    is.constructible(this.Type);
    is.subclass(this.type, Storeable);
    maybe.array(this.definition.predicates);
  }

  static resolve(name) {
    defined(name, "`name` required");
    const options = {
      optional: name.includes("?"),
      transient: name.includes("~"),
    };
    const property = name.replaceAll("~", "").replaceAll("?", "");
    return {options, property};
  }

  get type() {
    return builtins[this.Type] ?? this.custom;
  }

  get custom() {
    return this.is_domain ? DomainType : this.Type;
  }

  get is_domain() {
    return this.Type.prototype instanceof DomainType.instance;
  }

  get Type() {
    return this.definition.type;
  }

  get predicates() {
    return cache(this, "predicates", () => {
      const predicates = this.definition.predicates ?? [];
      return predicates.map(name => new Predicate(name));
    });
  }

  by_id(id) {
    return this.Type.by_id(id);
  }

  in(property, document) {
    const value = document[property];
    const in_function = this.definition.in;
    return in_function !== undefined ? in_function(value, document) : value;
  }

  verify_undefined() {
    return this.options.optional ? true : "Must not be empty";
  }

  async verify_defined(property, document) {
    try {
      await this.type.verify(property, document, this.predicates, this.Type);
      return true;
    } catch (error) {
      if (error instanceof PredicateError) {
        return error.message;
      }
      throw error;
    }
  }

  async verify(property, document) {
    document[property] = await this.in(property, document);
    return document[property] === undefined
      ? this.verify_undefined()
      : this.verify_defined(property, document);
  }

  serialize(value) {
    return value === undefined ? undefined : this.type.serialize(value);
  }

  deserialize(value) {
    return value === undefined ? undefined : this.type.deserialize(value);
  }
}
