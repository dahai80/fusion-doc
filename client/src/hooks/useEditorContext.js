import { createContext, useContext } from 'react';

const EditorContext = createContext(null);

export function EditorProvider({ editor, children }) {
    return (
        <EditorContext.Provider value={editor}>
            {children}
        </EditorContext.Provider>
    );
}

export function useEditorContext() {
    return useContext(EditorContext);
}
