#pragma once
// Minimal recursive-descent JSON parser (adapter layer, no external deps).
// Supports: object, array, string, number, bool, null. Numbers stored as double.
#include <cmath>
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace mj {

struct Value;
using Object = std::map<std::string, Value>;
using Array = std::vector<Value>;

struct Value {
    enum Type { NUL, BOOL, NUM, STR, ARR, OBJ } type = NUL;
    bool b = false;
    double num = 0;
    std::string str;
    std::shared_ptr<Array> arr;
    std::shared_ptr<Object> obj;

    bool is_num() const { return type == NUM && std::isfinite(num); }
    double get_num(double def) const { return is_num() ? num : def; }
    std::string get_str(const std::string& def) const {
        return type == STR ? str : def;
    }
    bool get_bool(bool def) const { return type == BOOL ? b : def; }
    bool get_bool(const std::string& key, bool def) const {
        const Value* v = find(key);
        return v ? v->get_bool(def) : def;
    }
    const Value* find(const std::string& key) const {
        if (type != OBJ || !obj) return nullptr;
        auto it = obj->find(key);
        return it == obj->end() ? nullptr : &it->second;
    }
    double get_num(const std::string& key, double def) const {
        const Value* v = find(key);
        return v ? v->get_num(def) : def;
    }
    std::string get_str(const std::string& key, const std::string& def) const {
        const Value* v = find(key);
        return v ? v->get_str(def) : def;
    }
};

class Parser {
public:
    explicit Parser(const std::string& s) : s_(s) {}
    bool parse(Value* out) {
        skip_ws();
        if (!parse_value(*out)) return false;
        skip_ws();
        return pos_ >= s_.size();
    }

private:
    const std::string& s_;
    size_t pos_ = 0;

    void skip_ws() {
        while (pos_ < s_.size() &&
               (s_[pos_] == ' ' || s_[pos_] == '\t' || s_[pos_] == '\n' ||
                s_[pos_] == '\r'))
            ++pos_;
    }
    bool eof() const { return pos_ >= s_.size(); }
    char peek() const { return s_[pos_]; }

    bool literal(const char* lit) {
        const size_t n = std::char_traits<char>::length(lit);
        if (s_.compare(pos_, n, lit) == 0) {
            pos_ += n;
            return true;
        }
        return false;
    }

    bool parse_value(Value& v) {
        if (eof()) return false;
        char c = peek();
        if (c == '{') return parse_obj(v);
        if (c == '[') return parse_arr(v);
        if (c == '"') return parse_str(v);
        if (literal("true")) { v = Value{}; v.type = Value::BOOL; v.b = true; return true; }
        if (literal("false")) { v = Value{}; v.type = Value::BOOL; v.b = false; return true; }
        if (literal("null")) { v = Value{}; return true; }
        return parse_num(v);
    }

    bool parse_num(Value& v) {
        size_t start = pos_;
        if (!eof() && (peek() == '-' || peek() == '+')) ++pos_;
        while (!eof() && (isdigit((unsigned char)peek()) || peek() == '.' ||
                          peek() == 'e' || peek() == 'E' || peek() == '-' ||
                          peek() == '+'))
            ++pos_;
        if (pos_ == start) return false;
        char* end = nullptr;
        double d = strtod(s_.c_str() + start, &end);
        if (end == s_.c_str() + start) return false;
        v = Value{};
        v.type = Value::NUM;
        v.num = d;
        return true;
    }

    bool parse_str(Value& v) {
        if (peek() != '"') return false;
        ++pos_;
        std::string out;
        while (!eof()) {
            char c = s_[pos_++];
            if (c == '"') {
                v = Value{};
                v.type = Value::STR;
                v.str = out;
                return true;
            }
            if (c == '\\' && !eof()) {
                char e = s_[pos_++];
                switch (e) {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'n': out += '\n'; break;
                case 't': out += '\t'; break;
                case 'r': out += '\r'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'u': {
                    if (pos_ + 4 > s_.size()) return false;
                    unsigned cp = (unsigned)strtoul(s_.c_str() + pos_, nullptr, 16);
                    pos_ += 4;
                    // encode as UTF-8 (BMP only, sufficient for this app)
                    if (cp < 0x80) out += (char)cp;
                    else if (cp < 0x800) {
                        out += (char)(0xC0 | (cp >> 6));
                        out += (char)(0x80 | (cp & 0x3F));
                    } else {
                        out += (char)(0xE0 | (cp >> 12));
                        out += (char)(0x80 | ((cp >> 6) & 0x3F));
                        out += (char)(0x80 | (cp & 0x3F));
                    }
                    break;
                }
                default: return false;
                }
            } else {
                out += c;
            }
        }
        return false;
    }

    bool parse_arr(Value& v) {
        ++pos_; // [
        v = Value{};
        v.type = Value::ARR;
        v.arr = std::make_shared<Array>();
        skip_ws();
        if (!eof() && peek() == ']') { ++pos_; return true; }
        while (true) {
            skip_ws();
            Value item;
            if (!parse_value(item)) return false;
            v.arr->push_back(std::move(item));
            skip_ws();
            if (eof()) return false;
            if (peek() == ',') { ++pos_; continue; }
            if (peek() == ']') { ++pos_; return true; }
            return false;
        }
    }

    bool parse_obj(Value& v) {
        ++pos_; // {
        v = Value{};
        v.type = Value::OBJ;
        v.obj = std::make_shared<Object>();
        skip_ws();
        if (!eof() && peek() == '}') { ++pos_; return true; }
        while (true) {
            skip_ws();
            Value key;
            if (!parse_str(key)) return false;
            skip_ws();
            if (eof() || peek() != ':') return false;
            ++pos_;
            skip_ws();
            Value item;
            if (!parse_value(item)) return false;
            (*v.obj)[key.str] = std::move(item);
            skip_ws();
            if (eof()) return false;
            if (peek() == ',') { ++pos_; continue; }
            if (peek() == '}') { ++pos_; return true; }
            return false;
        }
    }
};

inline bool parse(const std::string& text, Value* out) {
    return Parser(text).parse(out);
}

} // namespace mj
