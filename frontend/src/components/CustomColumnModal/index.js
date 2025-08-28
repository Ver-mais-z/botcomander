import React, { useState, useEffect } from "react";
import { Formik, Form, Field } from "formik";
import { toast } from "react-toastify";
import * as Yup from "yup";

import { makeStyles } from "@material-ui/core/styles";
import { green } from "@material-ui/core/colors";

import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import Dialog from "@material-ui/core/Dialog";
import DialogActions from "@material-ui/core/DialogActions";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";
import CircularProgress from "@material-ui/core/CircularProgress";

import { i18n } from "../../translate/i18n";

import api from "../../services/api";
import toastError from "../../errors/toastError";

const useStyles = makeStyles((theme) => ({
  root: {
    display: "flex",
    flexWrap: "wrap",
  },
  textField: {
    marginRight: theme.spacing(1),
    flex: 1,
  },
  btnWrapper: {
    position: "relative",
  },
  buttonProgress: {
    color: green[500],
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -12,
    marginLeft: -12,
  },
  formControl: {
    margin: theme.spacing(1),
    minWidth: 120,
  },
  messageField: {
    marginTop: theme.spacing(2),
  },
}));

const CustomColumnSchema = Yup.object().shape({
  name: Yup.string()
    .min(2, "Nome muito curto!")
    .max(50, "Nome muito longo!")
    .required("Nome da coluna é obrigatório"),
  message: Yup.string()
    .min(5, "Mensagem muito curta!")
    .max(1000, "Mensagem muito longa!")
    .required("Mensagem é obrigatória"),
});

const CustomColumnModal = ({ open, onClose, customColumnId, reload }) => {
  const classes = useStyles();

  const initialState = {
    name: "",
    message: "",
  };

  const [customColumn, setCustomColumn] = useState(initialState);

  useEffect(() => {
    const fetchCustomColumn = async () => {
      if (!customColumnId) return;
      try {
        const { data } = await api.get(`/custom-columns/${customColumnId}`);
        setCustomColumn(prevState => {
          return { ...prevState, ...data };
        });
      } catch (err) {
        toastError(err);
      }
    };

    fetchCustomColumn();
  }, [customColumnId, open]);

  const handleClose = () => {
    setCustomColumn(initialState);
    onClose();
  };

  const handleSaveCustomColumn = async (values) => {
    const customColumnData = { ...values };
    try {
      if (customColumnId) {
        await api.put(`/custom-columns/${customColumnId}`, customColumnData);
        toast.success("Coluna personalizada editada com sucesso!");
      } else {
        await api.post("/custom-columns", customColumnData);
        toast.success("Coluna personalizada criada com sucesso!");
      }
      if (typeof reload === 'function') {
        reload();
      }
    } catch (err) {
      toastError(err);
    }
    handleClose();
  };

  return (
    <div className={classes.root}>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        scroll="paper"
      >
        <DialogTitle id="form-dialog-title">
          {customColumnId
            ? "Editar Coluna Personalizada"
            : "Nova Coluna Personalizada"}
        </DialogTitle>
        <Formik
          initialValues={customColumn}
          enableReinitialize={true}
          validationSchema={CustomColumnSchema}
          onSubmit={(values, actions) => {
            setTimeout(() => {
              handleSaveCustomColumn(values);
              actions.setSubmitting(false);
            }, 400);
          }}
        >
          {({ touched, errors, isSubmitting }) => (
            <Form>
              <DialogContent dividers>
                <div className={classes.root}>
                  <Field
                    as={TextField}
                    label="Nome da Coluna"
                    name="name"
                    autoFocus
                    margin="dense"
                    variant="outlined"
                    className={classes.textField}
                    error={touched.name && Boolean(errors.name)}
                    helperText={touched.name && errors.name}
                    inputProps={{
                      maxLength: 50
                    }}
                  />
                </div>

                <div className={classes.messageField}>
                  <Field
                    as={TextField}
                    label="Mensagem"
                    name="message"
                    multiline
                    rows={6}
                    fullWidth
                    margin="dense"
                    variant="outlined"
                    error={touched.message && Boolean(errors.message)}
                    helperText={touched.message && errors.message}
                    inputProps={{
                      maxLength: 1000
                    }}
                    placeholder="Digite a mensagem que será enviada..."
                  />
                </div>
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={handleClose}
                  color="secondary"
                  disabled={isSubmitting}
                  variant="outlined"
                >
                  Cancelar
                </Button>
                <div className={classes.btnWrapper}>
                  <Button
                    type="submit"
                    color="primary"
                    disabled={isSubmitting}
                    variant="contained"
                  >
                    {customColumnId ? "Salvar" : "Adicionar"}
                  </Button>
                  {isSubmitting && (
                    <CircularProgress
                      size={24}
                      className={classes.buttonProgress}
                    />
                  )}
                </div>
              </DialogActions>
            </Form>
          )}
        </Formik>
      </Dialog>
    </div>
  );
};

export default CustomColumnModal;