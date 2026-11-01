"""New-password validation. Never transmit passwords or full hashes to a breach service."""
import hashlib
from urllib.request import Request, urlopen

PASSWORD_MIN_LENGTH = 15
PASSWORD_MAX_LENGTH = 128

class PasswordCheckUnavailable(Exception):
    pass

def check_new_password(password: str):
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise ValueError("Password must be 15-128 characters long.")
    if any(not 0x20 <= ord(character) <= 0x7E for character in password):
        raise ValueError("Use only English letters (A-Z, a-z), numbers, symbols, and spaces.")
    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    request = Request("https://api.pwnedpasswords.com/range/" + digest[:5],
                      headers={"Add-Padding": "true", "User-Agent": "BruiseWeb-Password-Check"})
    try:
        with urlopen(request, timeout=5) as response:
            body = response.read(2_000_000).decode("ascii")
        rows = [line.split(":") for line in body.splitlines()]
        if not rows or any(len(row) != 2 or len(row[0]) != 35 or not row[1].isdigit() for row in rows):
            raise PasswordCheckUnavailable()
    except (OSError, ValueError, UnicodeError) as exc:
        raise PasswordCheckUnavailable() from exc
    if any(suffix == digest[5:] and int(count) > 0 for suffix, count in rows):
        raise ValueError("This password appears in known data breaches. Choose another password.")
