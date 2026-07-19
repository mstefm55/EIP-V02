function StateNotice({ kind = "info", title, message }) {
  return (
    <div className={`state-notice ${kind}`}>
      {title ? <strong>{title}</strong> : null}
      {message ? <p>{message}</p> : null}
    </div>
  );
}

export default StateNotice;
