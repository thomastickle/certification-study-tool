import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryRepository } from '../src/server/questions/library-repository.ts';
import { QuizService } from '../src/server/quizzes/quiz-service.ts';

import { populate } from './quiz-fixtures.ts';

const options = { sourceFilter:'mixed',questionType:'mixed' };
test('starts a 20-minute weighted-domain quiz without leaking correct answers or mutating banks', () => {
  const repository = new LibraryRepository(':memory:');
  try {
    populate(repository); const before=repository.allQuestions();
    const quiz = new QuizService(repository,()=>1000,()=>0.25).start(options);
    assert.equal(quiz.questions.length,20);
    assert.equal(quiz.deadline,1000+20*60*1000);
    assert.deepEqual([1,2,3,4].map(d=>quiz.questions.filter(q=>q.domain===d).length),[5,6,7,2]);
    assert.equal(quiz.status,'active');
    assert.ok(quiz.questions.every(q=>q.correctAnswerIds===undefined && q.correct===undefined && q.answers.every(a=>!('correct' in a))));
    assert.deepEqual(repository.allQuestions(),before);
  } finally {repository.close();}
});

test('scores exact answer sets, unanswered misses, confidence and review marks; submission is idempotent', () => {
 const repository=new LibraryRepository(':memory:');
 try {
  populate(repository); const service=new QuizService(repository,()=>1000,()=>0.4); const quiz=service.start(options);
  const stored=repository.quizStore().find(quiz.id)!;
  const answers=quiz.questions.map((q,i)=>({questionId:q.questionId,selected:i<16 ? stored.keys[i]!.correct : [],confidence:i===0 ? 'Unsure' as const : 'Confident' as const,flagged:i===0}));
  const result=service.submit(quiz.id,{answers});
  assert.equal(result.correctCount,16); assert.equal(result.status,'completed');
  assert.equal(result.questions[0]!.confidence,'Unsure'); assert.equal(result.questions[0]!.flagged,true);
  assert.ok(result.questions.every(q=>q.correctAnswerIds));
  assert.equal(repository.quizStore().boosts().size,4);
  assert.deepEqual(service.submit(quiz.id,{answers:[]}),result);
  assert.equal(repository.quizStore().boosts().size,4);
 }finally{repository.close();}
});

test('deadline uses saved choices, refuses late changes, and expires without a submit request', () => {
 const repository=new LibraryRepository(':memory:');
 try{
  populate(repository);let now=1000;const service=new QuizService(repository,()=>now,()=>0.4);const quiz=service.start(options);
  const stored=repository.quizStore().find(quiz.id)!;
  const answers=quiz.questions.map((q,i)=>({questionId:q.questionId,selected:i===0 ? stored.keys[i]!.correct : [],confidence:null,flagged:false}));
  service.save(quiz.id,{answers});now=quiz.deadline;
  service.expireDue();
  assert.equal(repository.quizStore().find(quiz.id)!.status,'completed');
  const result=service.submit(quiz.id,{answers:answers.map((a,i)=>({...a,selected:stored.keys[i]!.correct}))});
  assert.equal(result.correctCount,1);assert.equal(result.finishedAt,quiz.deadline);
  assert.equal(service.recent().length,1);
 }finally{repository.close();}
});

test('abandon does not score or change mastery; validation rejects invalid selections and options', () => {
 const repository=new LibraryRepository(':memory:');
 try{
  populate(repository);const service=new QuizService(repository,()=>1000,()=>0.4);const quiz=service.start(options);
  const answers=quiz.questions.map(q=>({questionId:q.questionId,selected:[],confidence:null,flagged:false}));
  assert.throws(()=>service.save(quiz.id,{answers:answers.map((a,i)=>i ? a : {...a,selected:[999]})}),/Invalid answer selection/);
  assert.deepEqual(service.get(quiz.id).questions.map(q=>q.selected),answers.map(q=>q.selected));
  assert.equal(service.abandon(quiz.id).status,'abandoned');assert.equal(service.recent().length,0);assert.equal(repository.quizStore().boosts().size,0);
  assert.equal(service.submit(quiz.id,{answers}).status,'abandoned');
  assert.throws(()=>service.start({sourceFilter:'bad',questionType:'mixed'}),/valid source/);
 }finally{repository.close();}
});

test('missed fingerprints retain boost until three consecutive correct appearances, and reset on a miss', () => {
 const repository=new LibraryRepository(':memory:');
 try{
  const store=repository.quizStore();
  store.record('example',false);assert.ok(store.boosts().has('example'));
  store.record('example',true);store.record('example',true);assert.ok(store.boosts().has('example'));
  store.record('example',false);store.record('example',true);store.record('example',true);assert.ok(store.boosts().has('example'));
  store.record('example',true);assert.equal(store.boosts().has('example'),false);
 }finally{repository.close();}
});
